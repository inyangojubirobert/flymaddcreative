// API endpoint to get vote statistics and milestone progress
// Syncs data between votes, participants, and milestones tables

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // ========================================
        // 1. GET TOTAL VOTES FROM ALL PARTICIPANTS
        // ========================================
        const { data: participants, error: participantsError } = await supabase
            .from('participants')
            .select('id, total_votes, current_stage');

        if (participantsError) throw participantsError;

        const totalVotes = participants?.reduce((sum, p) => sum + (p.total_votes || 0), 0) || 0;
        const totalParticipants = participants?.length || 0;

        // ========================================
        // 2. GET ALL ACTIVE MILESTONES
        // ========================================
        const { data: milestones, error: milestonesError } = await supabase
            .from('milestones')
            .select('*')
            .eq('is_active', true)
            .order('vote_threshold', { ascending: true });

        if (milestonesError) throw milestonesError;

        // ========================================
        // 3. CALCULATE MILESTONE PROGRESS
        // ========================================
        const GOAL_VOTES = 1000000;
        const campaignProgress = (totalVotes / GOAL_VOTES) * 100;

        // Separate user milestones and campaign milestones
        const userMilestones = milestones?.filter(m => 
            ['bronze', 'silver', 'gold', 'platinum', 'diamond'].includes(m.stage?.toLowerCase())
        ) || [];

        const campaignMilestones = milestones?.filter(m => 
            m.stage?.toLowerCase() === 'campaign'
        ) || [];

        // Calculate which campaign milestones are reached
        const reachedCampaignMilestones = campaignMilestones.filter(m => 
            totalVotes >= m.vote_threshold
        );

        const nextCampaignMilestone = campaignMilestones.find(m => 
            totalVotes < m.vote_threshold
        );

        // ========================================
        // 4. COUNT PARTICIPANTS BY STAGE
        // ========================================
        const stageDistribution = {
            bronze: 0,
            silver: 0,
            gold: 0,
            platinum: 0,
            diamond: 0
        };

        // Calculate stage based on votes for each participant
        participants?.forEach(p => {
            const votes = p.total_votes || 0;
            if (votes >= 5000) stageDistribution.diamond++;
            else if (votes >= 980) stageDistribution.platinum++;
            else if (votes >= 500) stageDistribution.gold++;
            else if (votes >= 100) stageDistribution.silver++;
            else stageDistribution.bronze++;
        });

        // ========================================
        // 5. GET RECENT VOTE ACTIVITY
        // ========================================
        const { data: recentVotes, error: recentError } = await supabase
            .from('votes')
            .select('id, created_at')
            .order('created_at', { ascending: false })
            .limit(100);

        // Calculate votes in last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const votesLast24h = recentVotes?.filter(v => 
            new Date(v.created_at) > oneDayAgo
        ).length || 0;

        // ========================================
        // 6. RETURN SYNCHRONIZED DATA
        // ========================================
        res.status(200).json({
            success: true,
            stats: {
                totalVotes,
                totalParticipants,
                goalVotes: GOAL_VOTES,
                progressPercent: Math.min(campaignProgress, 100).toFixed(2),
                votesLast24h,
                votesToGoal: Math.max(0, GOAL_VOTES - totalVotes)
            },
            milestones: {
                user: userMilestones.map(m => ({
                    id: m.id,
                    name: m.name,
                    stage: m.stage,
                    voteThreshold: m.vote_threshold,
                    icon: m.badge_icon,
                    reward: m.reward_description,
                    participantCount: stageDistribution[m.stage?.toLowerCase()] || 0
                })),
                campaign: campaignMilestones.map(m => ({
                    id: m.id,
                    name: m.name,
                    voteThreshold: m.vote_threshold,
                    icon: m.badge_icon,
                    reward: m.reward_description,
                    reached: totalVotes >= m.vote_threshold,
                    progress: Math.min((totalVotes / m.vote_threshold) * 100, 100).toFixed(2)
                })),
                reached: reachedCampaignMilestones.map(m => m.name),
                next: nextCampaignMilestone ? {
                    name: nextCampaignMilestone.name,
                    voteThreshold: nextCampaignMilestone.vote_threshold,
                    votesNeeded: nextCampaignMilestone.vote_threshold - totalVotes,
                    icon: nextCampaignMilestone.badge_icon
                } : null
            },
            stageDistribution,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Vote stats error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch vote statistics',
            details: error.message 
        });
    }
}
