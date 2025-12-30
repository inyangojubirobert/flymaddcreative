import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
    try {
        const { data, error } = await supabase
            .from('participants')
            .select('id')
            .limit(1);
        
        if (error) throw error;
        
        res.status(200).json({ 
            status: 'ok', 
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'error', 
            database: 'disconnected',
            error: err.message 
        });
    }
}
