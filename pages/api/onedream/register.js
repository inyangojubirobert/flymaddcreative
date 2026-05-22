// API route for user registration - aligned with participants table

import { registerParticipant } from '../../../src/backend/supabase.js';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { name, email, username, password, ref_code } = req.body;

    // Validate
    if (!name?.trim() || !email?.trim() || !username?.trim() || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email' });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]+$/.test(cleanUsername) || cleanUsername.length < 3) {
        return res.status(400).json({ error: 'Username: 3+ chars, letters/numbers/underscores' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password: 6+ characters' });
    }

    try {
        // Resolve merchant referral link ID from ref_code if provided
        let referredByMerchantLinkId = null;
        if (ref_code) {
            const { data: link } = await supabase
                .from('merchant_referral_links')
                .select('id')
                .eq('link_code', ref_code)
                .eq('is_active', true)
                .maybeSingle();
            if (link) referredByMerchantLinkId = link.id;
        }

        const participant = await registerParticipant(name, email, cleanUsername, password, referredByMerchantLinkId);

        const token = jwt.sign(
            { userId: participant.id, email: participant.email, type: 'onedream' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({ success: true, participant: { ...participant, token } });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Registration failed.' });
    }
}