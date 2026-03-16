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

    if (!merchant_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Check if email already exists
    const { data: existingMerchant } = await supabase
      .from('referral_merchants')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existingMerchant) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

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

      if (insertError.message && insertError.message.includes('password_hash')) {
        return res.status(500).json({
          success: false,
          message: 'Server misconfiguration: merchant password storage is not set up. Please add a password_hash column to referral_merchants.'
        });
      }

      if (insertError.code === '23505' && insertError.message.includes('email')) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered'
        });
      }

      throw insertError;
    }

    const { data: referralLink, error: linkError } = await supabase
      .from('merchant_referral_links')
      .select('id, link_code, full_link, is_active')
      .eq('merchant_id', merchant.id)
      .single();

    if (linkError) {
      console.error('Error fetching referral link:', linkError);
    }

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
      referral_link: referralLink || null
    });

  } catch (error) {
    console.error('Merchant registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}
