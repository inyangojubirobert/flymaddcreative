// API route for user registration
// Creates onedream_users entry and generates referral token

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateReferralToken, checkRateLimit } from '../../../lib/onedreamHelpers';
import crypto from 'crypto';

// Initialize Supabase client with service role key for admin operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// Helpers
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function cleanName(name) {
  return (name || '').trim().replace(/\s+/g, ' ');
}
function generateReferralCode(name) {
  const clean = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const prefix = clean.substring(0, 6) || 'user';
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${prefix}${suffix}`;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      // Store as scrypt$<salt hex>$<hash hex>
      resolve(`scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}
async function ensureUniqueReferral(code, maxAttempts = 5) {
  let attempt = 0;
  let current = code;
  while (attempt < maxAttempts) {
    const { data, error } = await supabaseAdmin
      .from('onedream_users')
      .select('id')
      .eq('referral_code', current)
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return current;
    current = generateReferralCode(current);
    attempt++;
  }
  return current;
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - max 5 registration attempts per IP per hour
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(`register_${clientIP}`, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ 
      error: 'Too many registration attempts. Please try again later.' 
    });
  }

  const { name, email, password, bio } = req.body;

  // Validate required fields
  if (!name || !email || !password) {
    return res.status(400).json({ 
      error: 'Name, email, and password are required' 
    });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      error: 'Please provide a valid email address' 
    });
  }

  // Validate password length
  if (password.length < 6) {
    return res.status(400).json({ 
      error: 'Password must be at least 6 characters long' 
    });
  }

  try {
    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('onedream_users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(400).json({ 
        error: 'An account with this email already exists' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user record
    const userId = crypto.randomUUID();
    const referralToken = generateReferralToken(userId);
    
    const { data: newUser, error: createError } = await supabaseAdmin
      .from('onedream_users')
      .insert({
        id: userId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password_hash: hashedPassword, // Note: Add this column to your schema
        bio: bio?.trim() || null,
        referral_token: referralToken
      })
      .select('id, name, email, referral_token, created_at')
      .single();

    if (createError) {
      console.error('User creation error:', createError);
      return res.status(500).json({ 
        error: 'Failed to create account. Please try again.' 
      });
    }

    // Generate JWT token for session
    const token = jwt.sign(
      { 
        userId: newUser.id, 
        email: newUser.email,
        type: 'onedream' 
      },
      process.env.JWT_SECRET || 'fallback_secret_for_dev',
      { expiresIn: '7d' }
    );

    // Return success response (don't include password hash)
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        referralToken: newUser.referral_token,
        createdAt: newUser.created_at
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Internal server error. Please try again later.' 
    });
  }
}

// Helper function to validate environment variables
export function validateEnvVars() {
  const requiredVars = ['SUPABASE_URL'];
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.warn(`Warning: Missing environment variables: ${missing.join(', ')}`);
    console.warn('Using fallback configuration for development.');
  }
}

// Mock user creation for development when Supabase is not configured
async function createMockUser(userData) {
  // In development, you could store users in a local JSON file or in-memory store
  // This is just a placeholder for when Supabase is not available
  console.log('Mock user creation:', userData);
  
  return {
    id: crypto.randomUUID(),
    ...userData,
    created_at: new Date().toISOString()
  };
}