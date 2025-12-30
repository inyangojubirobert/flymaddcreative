// API route for user registration - aligned with participants table

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Initialize Supabase client with service role key
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// Simple in-memory rate limiter
const rateLimitStore = new Map();
function checkRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  rateLimitStore.set(key, entry);
  return entry.count <= maxAttempts;
}

// Generate a unique referral token
async function generateReferralToken() {
  const token = crypto.randomBytes(16).toString('hex');
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('referral_token', token)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error('Error checking referral token uniqueness: ' + error.message);
  }

  return data ? generateReferralToken() : token;
}

// Ensure the referral token is unique for the user
async function ensureUniqueReferralToken(userId, token) {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id')
    .eq('referral_token', token)
    .neq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error('Error ensuring unique referral token: ' + error.message);
  }

  return data ? generateReferralToken() : token;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - max 5 per IP per hour
  const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(`register_${clientIP}`, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const { name, email, username } = req.body;

  // Validate required fields
  if (!name || !email || !username) {
    return res.status(400).json({ error: 'Name, email, and username are required' });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Validate username format
  const normalizedUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalizedUsername) || normalizedUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters (letters, numbers, underscores)' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    // Check existing email
    const { data: existingEmail } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('email', normalizedEmail)
      .limit(1);

    if (existingEmail?.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    // Check existing username
    const { data: existingUsername } = await supabaseAdmin
      .from('participants')
      .select('id')
      .eq('username', normalizedUsername)
      .limit(1);

    if (existingUsername?.length > 0) {
      return res.status(400).json({ error: 'This username is already taken.' });
    }

    // Insert participant (triggers will generate user_code and referral_link)
    const { data: participant, error: insertErr } = await supabaseAdmin
      .from('participants')
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        username: normalizedUsername
      })
      .select('id, name, email, username, user_code, total_votes, current_stage, created_at')
      .single();

    if (insertErr) {
      console.error('Insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to create account: ' + insertErr.message });
    }

    // Wait for trigger to create referral link
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get referral link
    const { data: referralLink } = await supabaseAdmin
      .from('referral_links')
      .select('user_vote_link')
      .eq('participant_id', participant.id)
      .single();

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: participant.id, 
        email: normalizedEmail,
        type: 'onedream' 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      participant: {
        ...participant,
        voteLink: referralLink?.user_vote_link || `https://www.flymaddcreative.online/vote.html?user=${normalizedUsername}`
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}