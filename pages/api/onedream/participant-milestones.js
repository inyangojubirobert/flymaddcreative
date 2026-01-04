// API endpoint to get a participant's achieved milestones
// Returns all milestones achieved by a specific participant

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

    const { participant_id, username } = req.query;

    if (!participant_id && !username) {
        return res.status(400).json({ 
            error: 'participant_id or username is required' 
        });
    }

    try {
        // Get participant
        let participant;
        
        if (participant_id) {
            const { data, error } = await supabase
                .from('participants')
                .select('id, name, username, total_votes, current_stage')
                .eq('id', participant_id)
                .single();
            if (error) throw error;
            participant = data;
        } else {
            const { data, error } = await supabase
                .from('participants')
                .select('id, name, username, total_votes, current_stage')
                .eq('username', username.toLowerCase())
                .single();
            if (error) throw error;
            participant = data;
        }

        if (!participant) {
            return res.status(404).json({ error: 'Participant not found' });
        }

        // Get achieved milestones for this participant
        const { data: achievements, error: achieveError } = await supabase
            .from('participant_milestones')
            .select(`
                id,
                achieved_at,
                votes_at_achievement,
                notified,
                milestone:milestones (
                    id,
                    name,
                    description,
                    vote_threshold,
                    stage,
                    badge_icon,
                    reward_description
                )
            `)
            .eq('participant_id', participant.id)
            .order('achieved_at', { ascending: true });

        if (achieveError) throw achieveError;

        // Get all available milestones to show progress
        const { data: allMilestones, error: milestonesError } = await supabase
            .from('milestones')
            .select('id, name, vote_threshold, stage, badge_icon')
            .eq('is_active', true)
            .order('vote_threshold', { ascending: true });

        if (milestonesError) throw milestonesError;

        // Calculate which milestones are next
        const achievedIds = new Set(achievements?.map(a => a.milestone?.id) || []);
        const upcomingMilestones = allMilestones?.filter(m => 
            !achievedIds.has(m.id) && m.vote_threshold > participant.total_votes
        ) || [];

        const nextMilestone = upcomingMilestones[0] || null;

        res.status(200).json({
            success: true,
            participant: {
                id: participant.id,
                name: participant.name,
                username: participant.username,
                totalVotes: participant.total_votes,
                currentStage: participant.current_stage
            },
            achievements: achievements?.map(a => ({
                id: a.id,
                achievedAt: a.achieved_at,
                votesAtAchievement: a.votes_at_achievement,
                milestone: a.milestone
            })) || [],
            totalAchieved: achievements?.length || 0,
            nextMilestone: nextMilestone ? {
                id: nextMilestone.id,
                name: nextMilestone.name,
                voteThreshold: nextMilestone.vote_threshold,
                votesNeeded: nextMilestone.vote_threshold - participant.total_votes,
                icon: nextMilestone.badge_icon
            } : null,
            allMilestones: allMilestones?.map(m => ({
                ...m,
                achieved: achievedIds.has(m.id),
                progress: Math.min((participant.total_votes / m.vote_threshold) * 100, 100).toFixed(1)
            }))
        });

    } catch (error) {
        console.error('Participant milestones error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch participant milestones',
            details: error.message 
        });
    }
}
