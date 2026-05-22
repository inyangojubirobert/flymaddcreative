import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { email, password } = req.body;

        if (!email?.trim() || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Look up merchant by email
        const { data: merchant, error } = await supabase
            .from('referral_merchants')
            .select('*')
            .eq('email', normalizedEmail)
            .single();

        if (error || !merchant) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Check account is active
        if (merchant.status !== 'active') {
            return res.status(403).json({ success: false, error: 'Account is not active. Please contact support.' });
        }

        // Verify password
        if (!merchant.password_hash) {
            return res.status(500).json({ success: false, error: 'Account not fully configured. Please contact support.' });
        }

        const validPassword = await bcrypt.compare(password, merchant.password_hash);
        if (!validPassword) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Get merchant's referral links
        const { data: referralLinks } = await supabase
            .from('merchant_referral_links')
            .select('id, link_code, full_link, description, is_active, clicks_count, registrations_count, created_at')
            .eq('merchant_id', merchant.id)
            .order('created_at', { ascending: false });

        // Sign JWT
        const token = jwt.sign(
            { id: merchant.id, email: merchant.email, type: 'merchant' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Strip password hash before sending
        const { password_hash, ...safeMerchant } = merchant;

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            merchant: {
                ...safeMerchant,
                token
            },
            referral_links: referralLinks || []
        });

    } catch (err) {
        console.error('Merchant login error:', err);
        return res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
    }
}
