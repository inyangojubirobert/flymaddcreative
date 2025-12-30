import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const query = req.query.q?.trim();
    if (!query) {
        return res.status(200).json({ participants: [] });
    }
    
    try {
        const { data, error } = await supabase
            .from('participants')
            .select('id, name, username, user_code, total_votes, current_stage')
            .or(`username.ilike.%${query}%,user_code.ilike.%${query}%,name.ilike.%${query}%`)
            .order('total_votes', { ascending: false })
            .limit(20);
        
        if (error) throw error;
        
        res.status(200).json({ participants: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
