// API route for user login
// Handles authentication for onedream_users table
// Returns JWT token for session management

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
        return res.status(400).json({ 
            error: 'Email and password are required' 
        });
    }

    try {
        // Find user by email
        const { data: users, error: findError } = await supabaseAdmin
            .from('onedream_users')
            .select('id, name, email, password_hash, referral_token, bio, created_at')
            .eq('email', email.toLowerCase().trim())
            .limit(1);

        if (findError) {
            console.error('Database error:', findError);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!users || users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];

        // Verify password
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email,
                type: 'onedream' 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Return user data (without password hash)
        res.status(200).json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                referralToken: user.referral_token,
                bio: user.bio,
                createdAt: user.created_at
            },
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}