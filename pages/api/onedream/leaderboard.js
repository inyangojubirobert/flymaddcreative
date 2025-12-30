import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    try {
        const { data, error } = await supabase
            .from('participants')
            .select('id, name, username, user_code, total_votes, total_amount, current_stage, created_at')
            .order('total_votes', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        res.status(200).json({ participants: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
