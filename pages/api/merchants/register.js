// Canonical merchant registration endpoint - used by the website
// (public/merchant-register.html), the web app at /app and the APK
// (mobile/src/api/merchants.ts). pages/api/merchant/register.js re-exports
// this handler so older callers get identical behavior.
//
// Response shape (both clients depend on it):
//   { success, message, merchant: { ...merchant, token, referral_link: <full_link string|null> },
//     referral_link: { id, link_code, full_link, is_active } | null }
// The token payload matches pages/api/merchants/login.js ({ id, email,
// type: 'merchant' }) so lib/merchantAuth.js accepts it on the dashboard,
// links, withdraw and profile routes.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getJwtSecret } from '../../../lib/jwtSecret';
import { checkRateLimit } from '../../../lib/onedreamHelpers';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same MERCH-XXXXXXXX format as pages/api/merchants/[id]/links.js, which is
// what registration.html's ?ref= handling expects.
function generateLinkCode() {
  return 'MERCH-' + crypto.randomBytes(5).toString('hex').toUpperCase().substring(0, 8);
}

// Some environments have a DB trigger that creates the first referral link
// on insert; others don't. Use the trigger's link if present, otherwise
// create one so every new merchant leaves registration with a link.
async function ensureReferralLink(merchant) {
  const { data: existing, error: fetchError } = await supabase
    .from('merchant_referral_links')
    .select('id, link_code, full_link, is_active')
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError) console.error('Error fetching referral link:', fetchError);
  if (existing) return existing;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online';

  // Retry on the (unlikely) chance of a link_code collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const linkCode = generateLinkCode();
    const { data: link, error } = await supabase
      .from('merchant_referral_links')
      .insert({
        merchant_id: merchant.id,
        link_code: linkCode,
        full_link: `${siteUrl}/registration.html?ref=${linkCode}`,
        description: `Referral link for ${merchant.merchant_name}`,
        is_active: true,
        clicks_count: 0,
        registrations_count: 0
      })
      .select('id, link_code, full_link, is_active')
      .single();

    if (!error) return link;
    if (error.code !== '23505') {
      console.error('Error creating referral link:', error);
      return null;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Best effort (per serverless instance): slows scripted sign-ups.
  const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(`merchant_register_${clientIp}`, 5, 10 * 60 * 1000)) {
    return res.status(429).json({ success: false, error: 'Too many sign-up attempts. Please wait a few minutes and try again.' });
  }

  try {
    const { merchant_name, email, company_name, wallet_address, password } = req.body || {};

    if (typeof merchant_name !== 'string' || !merchant_name.trim()
      || typeof email !== 'string' || !email.trim()
      || typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, error: 'Merchant name, email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    if (merchant_name.trim().length > 100 || (typeof company_name === 'string' && company_name.trim().length > 150)) {
      return res.status(400).json({ success: false, error: 'Name or company name is too long' });
    }

    // limit(1) + maybeSingle: .single() errored on zero rows and on
    // duplicate rows, and the duplicate case slipped past this check.
    const { data: existingMerchant, error: existingError } = await supabase
      .from('referral_merchants')
      .select('id')
      .eq('email', normalizedEmail)
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingMerchant) {
      return res.status(409).json({ success: false, error: 'Email already registered. Please log in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: merchant, error: insertError } = await supabase
      .from('referral_merchants')
      .insert({
        merchant_name: merchant_name.trim(),
        email: normalizedEmail,
        company_name: typeof company_name === 'string' ? company_name.trim() || null : null,
        wallet_address: typeof wallet_address === 'string' ? wallet_address.trim() || null : null,
        password_hash: passwordHash,
        total_tokens_earned: 0,
        available_tokens: 0,
        status: 'active'
      })
      .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({ success: false, error: 'Email already registered. Please log in instead.' });
      }
      throw insertError;
    }

    const referralLink = await ensureReferralLink(merchant);

    const token = jwt.sign(
      { id: merchant.id, email: merchant.email, type: 'merchant' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Merchant registered successfully',
      merchant: {
        ...merchant,
        token,
        referral_link: referralLink?.full_link || null
      },
      referral_link: referralLink || null
    });
  } catch (error) {
    console.error('Merchant registration error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
}
