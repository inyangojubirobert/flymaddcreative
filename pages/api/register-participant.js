import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createParticipant, getParticipantByEmail, getParticipantByUsername, getReferralLink } from '../../src/backend/supabase.js';

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const { name, email, username, password } = req.body;
    
    if (!name?.trim() || !email?.trim() || !username?.trim() || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    
    try {
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedUsername = username.trim().toLowerCase();
        
        // Check duplicates
        const existingEmail = await getParticipantByEmail(normalizedEmail);
        if (existingEmail) return res.status(400).json({ error: 'Email already registered' });
        
        const existingUsername = await getParticipantByUsername(normalizedUsername);
        if (existingUsername) return res.status(400).json({ error: 'Username taken' });
        
        // Hash & create
        const hash = await bcrypt.hash(password, 12);
        const participant = await createParticipant(name, normalizedEmail, normalizedUsername, hash);
        
        // Get referral link
        await new Promise(r => setTimeout(r, 300));
        const voteLink = await getReferralLink(participant.id) 
            || `https://www.flymaddcreative.online/vote.html?user=${normalizedUsername}`;
        
        // JWT
        const token = jwt.sign({ userId: participant.id, email: participant.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.status(201).json({
            success: true,
            participant: { ...participant, token, voteLink }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
}
