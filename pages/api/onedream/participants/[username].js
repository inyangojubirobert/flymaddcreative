import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { username } = req.query;
    
    try {
        const { data, error } = await supabase
            .from('participants')
            .select('id, name, email, username, user_code, total_votes, total_amount, current_stage, achievement_badges, created_at')
            .eq('username', username.toLowerCase())
            .single();
        
        if (error || !data) {
            return res.status(404).json({ error: 'Participant not found' });
        }
        
        // Get referral link
        const { data: referralLink } = await supabase
            .from('referral_links')
            .select('user_vote_link')
            .eq('participant_id', data.id)
            .single();
        
        res.status(200).json({ 
            participant: {
                ...data,
                voteLink: referralLink?.user_vote_link || `https://www.flymaddcreative.online/vote.html?user=${data.username}`
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
