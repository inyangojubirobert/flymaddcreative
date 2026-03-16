// pages/api/merchants/register.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { merchant_name, email, company_name, wallet_address, password } = req.body;
        
        if (!merchant_name || !email || !password) {
            return res.status(400).json({ error: 'Merchant name, email and password are required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Check if email exists
        const { data: existingMerchant } = await supabase
            .from('referral_merchants')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle();

        if (existingMerchant) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        
        const { data: merchant, error: insertError } = await supabase
            .from('referral_merchants')
            .insert({
                merchant_name: merchant_name.trim(),
                email: email.toLowerCase().trim(),
                company_name: company_name?.trim() || null,
                wallet_address: wallet_address?.trim() || null,
                password_hash: passwordHash,
                total_tokens_earned: 0,
                available_tokens: 0,
                status: 'active'
            })
            .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
            .single();

        if (insertError) {
            console.error('Insert error:', insertError);
            if (insertError.code === '23505') {
                return res.status(400).json({ error: 'Email already registered' });
            }
            throw insertError;
        }

        // Wait for trigger to create referral link
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const { data: referralLink } = await supabase
            .from('merchant_referral_links')
            .select('full_link')
            .eq('merchant_id', merchant.id)
            .maybeSingle();

        const token = jwt.sign(
            { merchantId: merchant.id, email: merchant.email },
            process.env.JWT_SECRET || 'onedream_secret_2024',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            merchant: {
                id: merchant.id,
                merchant_name: merchant.merchant_name,
                email: merchant.email,
                company_name: merchant.company_name,
                wallet_address: merchant.wallet_address,
                total_tokens_earned: merchant.total_tokens_earned,
                available_tokens: merchant.available_tokens,
                status: merchant.status,
                created_at: merchant.created_at,
                token,
                referral_link: referralLink?.full_link || null
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
}