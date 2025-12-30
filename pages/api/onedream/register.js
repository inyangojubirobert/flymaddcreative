// API route for user registration - aligned with participants table

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getParticipantByEmail, getParticipantByUsername, createParticipant, getReferralLink } from '../../../src/backend/supabase.js';

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';

// Rate limiting
const rateLimit = new Map();

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    // Rate limit: 5 per hour per IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const now = Date.now();
    const entry = rateLimit.get(ip) || { count: 0, start: now };
    if (now - entry.start > 3600000) { entry.count = 0; entry.start = now; }
    if (++entry.count > 5) {
        rateLimit.set(ip, entry);
        return res.status(429).json({ error: 'Too many attempts' });
    }
    rateLimit.set(ip, entry);
    
    const { name, email, username, password } = req.body;
    
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
        // Check duplicates
        const existingEmail = await getParticipantByEmail(email);
        if (existingEmail) return res.status(400).json({ error: 'Email already registered' });
        
        const existingUsername = await getParticipantByUsername(cleanUsername);
        if (existingUsername) return res.status(400).json({ error: 'Username taken' });
        
        // Hash & create
        const hash = await bcrypt.hash(password, 12);
        const participant = await createParticipant(name, email, cleanUsername, hash);
        
        // Wait for trigger, get referral link
        await new Promise(r => setTimeout(r, 300));
        const voteLink = await getReferralLink(participant.id) 
            || `https://www.flymaddcreative.online/vote.html?user=${cleanUsername}`;
        
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