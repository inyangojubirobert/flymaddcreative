// pages/api/merchants/register.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    // CORS headers (same as participant)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const { merchant_name, email, company_name, wallet_address, password } = req.body;
    
    // Validation (simplified like participant)
    if (!merchant_name?.trim() || !email?.trim() || !password) {
        return res.status(400).json({ error: 'Merchant name, email and password are required' });
    }
    
    try {
        const normalizedEmail = email.trim().toLowerCase();
        
        // Check if email already exists (using maybeSingle to avoid errors)
        const { data: existingMerchant } = await supabase
            .from('referral_merchants')
            .select('id')
            .eq('email', normalizedEmail)
            .maybeSingle();
            
        if (existingMerchant) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        // Hash password (using 12 rounds like participant)
        const passwordHash = await bcrypt.hash(password, 12);
        
        // Insert merchant
        const { data: merchant, error: insertError } = await supabase
            .from('referral_merchants')
            .insert({
                merchant_name: merchant_name.trim(),
                email: normalizedEmail,
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
            if (insertError.code === '23505') {
                return res.status(400).json({ error: 'Email already registered' });
            }
            throw insertError;
        }
        
        // Small delay to allow trigger to create referral link (like participant)
        await new Promise(r => setTimeout(r, 300));
        
        // Get the auto-generated referral link
        const { data: referralLink } = await supabase
            .from('merchant_referral_links')
            .select('link_code, full_link, is_active')
            .eq('merchant_id', merchant.id)
            .maybeSingle();

        // Generate JWT token (like participant)
        const token = jwt.sign(
            { 
                merchantId: merchant.id, 
                email: merchant.email,
                type: 'merchant' 
            }, 
            JWT_SECRET, 
            { expiresIn: '7d' }
        );
        
        // Return success (matching participant structure)
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
                referral_link: referralLink?.full_link || null,
                link_code: referralLink?.link_code || null
            }
        });
        
    } catch (err) {
        console.error('Merchant registration error:', err);
        res.status(500).json({ error: 'Registration failed' });
    }
}