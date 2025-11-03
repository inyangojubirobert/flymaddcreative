// API route for user login
// Handles authentication for onedream_users table
// Returns JWT token for session management

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '../../../lib/onedreamHelpers';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Mock users for development/demo
const DEMO_USERS = [
  {
    id: 'demo-user-1',
    email: 'demo@onedream.com',
    password: 'demo123', // In real app, this would be hashed
    name: 'Demo User',
    referral_token: 'demo123abc'
  }
];

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - max 10 login attempts per IP per 15 minutes
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(`login_${clientIP}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ 
      error: 'Too many login attempts. Please try again in 15 minutes.' 
    });
  }

  const { email, password } = req.body;

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required' 
    });
  }

  try {
    let user = null;

    // Check demo users first
    const demoUser = DEMO_USERS.find(u => u.email === email.toLowerCase());
    if (demoUser && demoUser.password === password) {
      user = {
        id: demoUser.id,
        name: demoUser.name,
        email: demoUser.email,
        referral_token: demoUser.referral_token
      };
    } else {
      // Try to authenticate with Supabase
      const { data: userData, error } = await supabase
        .from('onedream_users')
        .select('id, name, email, password_hash, referral_token')
        .eq('email', email.toLowerCase())
        .single();

      if (error || !userData) {
        return res.status(401).json({ 
          error: 'Invalid email or password' 
        });
      }

      // Verify password
      if (userData.password_hash) {
        const passwordValid = await bcrypt.compare(password, userData.password_hash);
        if (!passwordValid) {
          return res.status(401).json({ 
            error: 'Invalid email or password' 
          });
        }
      }

      user = {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        referral_token: userData.referral_token
      };
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        type: 'onedream' 
      },
      process.env.JWT_SECRET || 'fallback_secret_for_dev',
      { expiresIn: '7d' }
    );

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        referralToken: user.referral_token
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Internal server error. Please try again later.' 
    });
  }
}

// Middleware to verify JWT token
export function verifyToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || 
                req.cookies?.onedream_token ||
                req.body?.token;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev');
    
    if (decoded.type !== 'onedream') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Helper function to extract user from token (for use in other API routes)
export function getUserFromToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_for_dev');
    return decoded.type === 'onedream' ? decoded : null;
  } catch (error) {
    return null;
  }
}