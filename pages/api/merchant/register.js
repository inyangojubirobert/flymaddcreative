// pages/api/merchants/register.js
import bcrypt from 'bcryptjs';
import { getParticipantByEmail, registerParticipant } from '../../../src/backend/supabase';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client directly (since supabase.js doesn't export the client)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

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

        // Check if email already exists in referral_merchants table
        const { data: existingMerchant, error: checkError } = await supabase
            .from('referral_merchants')
            .select('id')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle(); // Use maybeSingle instead of single to avoid error when no results

        if (existingMerchant) {
            return res.status(409).json({ success: false, message: 'Email already registered' });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // Insert merchant into referral_merchants table
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
            console.error('Supabase insert error:', insertError);
            
            // Check for duplicate email error
            if (insertError.code === '23505') {
                return res.status(409).json({ success: false, message: 'Email already registered' });
            }
            
            return res.status(500).json({ 
                success: false, 
                message: 'Database error: ' + insertError.message 
            });
        }

        // Get the auto-generated referral link (created by database trigger)
        const { data: referralLink, error: linkError } = await supabase
            .from('merchant_referral_links')
            .select('id, link_code, full_link, is_active')
            .eq('merchant_id', merchant.id)
            .maybeSingle();

        if (linkError) {
            console.error('Error fetching referral link:', linkError);
        }

        // Return success response
        res.status(201).json({
            success: true,
            message: 'Merchant registered successfully',
            merchant: {
                id: merchant.id,
                merchant_name: merchant.merchant_name,
                email: merchant.email,
                company_name: merchant.company_name,
                wallet_address: merchant.wallet_address,
                total_tokens_earned: merchant.total_tokens_earned,
                available_tokens: merchant.available_tokens,
                status: merchant.status,
                created_at: merchant.created_at
            },
            referral_link: referralLink ? {
                full_link: referralLink.full_link,
                link_code: referralLink.link_code
            } : null
        });
        
    } catch (error) {
        console.error('Merchant registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error: ' + error.message 
        });
    }
}