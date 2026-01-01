// API endpoint: /api/onedream/participants/code/[code]
// Returns participant info by user_code

import { supabase } from '../../../../../../src/backend/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code } = req.query;
    if (!code || typeof code !== 'string' || code.length !== 8) {
        return res.status(400).json({ error: 'Invalid or missing participant code' });
    }

    try {
        const { data, error } = await supabase
            .from('participants')
            .select('id, name, username, email, user_code, total_votes, created_at')
            .eq('user_code', code.toUpperCase())
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Participant not found' });
        }

        // Optionally, add rank
        const { count } = await supabase
            .from('participants')
            .select('id', { count: 'exact', head: true })
            .gt('total_votes', data.total_votes);

        const participant = {
            ...data,
            rank: (count || 0) + 1
        };

        return res.status(200).json({ participant });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
