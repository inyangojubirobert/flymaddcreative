// API route for fetching milestones
// Returns milestone configurations from the database

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
        const { data, error } = await supabase
            .from('milestones')
            .select('*')
            .eq('is_active', true)
            .order('vote_threshold', { ascending: true });

        if (error) throw error;

        // Transform data for frontend use
        const milestones = data.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
            voteThreshold: m.vote_threshold,
            stage: m.stage,
            icon: m.badge_icon,
            reward: m.reward_description,
            isActive: m.is_active
        }));

        res.status(200).json({
            success: true,
            milestones,
            count: milestones.length
        });

    } catch (error) {
        console.error('Milestones error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch milestones',
            details: error.message 
        });
    }
}
