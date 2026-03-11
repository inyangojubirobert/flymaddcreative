// pages/api/merchants/register.js
import { createRouter } from 'next-connect';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { merchant_name, email, company_name, wallet_address, password } = req.body;
        
        // Validation
        if (!merchant_name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        }

        // Check if email already exists
        const { data: existingMerchant } = await supabase
            .from('referral_merchants')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .single();

        if (existingMerchant) {
            return res.status(409).json({ success: false, message: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        
        const { data: merchant, error: insertError } = await supabase
            .from('referral_merchants')
            .insert({
                merchant_name: merchant_name.trim(),
                email: email.toLowerCase().trim(),
                company_name: company_name?.trim() || null,
                wallet_address: wallet_address?.trim() || null,
                password_hash: passwordHash
            })
            .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
            .single();

        if (insertError) {
            console.error('Supabase insert error:', insertError);
            if (insertError.code === '23505') {
                return res.status(409).json({ success: false, message: 'Email already registered' });
            }
            throw insertError;
        }

        // Get the auto-generated referral link
        const { data: referralLink } = await supabase
            .from('merchant_referral_links')
            .select('id, link_code, full_link, is_active')
            .eq('merchant_id', merchant.id)
            .single();

        res.status(201).json({
            success: true,
            message: 'Merchant registered successfully',
            merchant,
            referral_link: referralLink || null
        });
        
    } catch (error) {
        console.error('Merchant registration error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
}