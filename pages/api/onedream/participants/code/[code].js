// API endpoint: /api/onedream/participants/code/[code]
// Returns participant info by user_code

import { getParticipantByUserCode } from '../../../../../src/backend/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { code } = req.query;
    if (!code || typeof code !== 'string' || code.length !== 8) {
        return res.status(400).json({ error: 'Invalid or missing participant code' });
    }

    try {
        const data = await getParticipantByUserCode(code);

        if (!data) {
            return res.status(404).json({ error: 'Participant not found' });
        }

        // Return participant (rank can be computed separately if needed)
        const participant = {
            id: data.id,
            name: data.name,
            username: data.username,
            email: data.email,
            user_code: data.user_code,
            total_votes: data.total_votes,
            created_at: data.created_at
        };

        return res.status(200).json({ participant });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
