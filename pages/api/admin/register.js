import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { createAdminToken } from '../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Admin registration - requires ADMIN_REGISTRATION_SECRET to prevent unauthorized signups
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, display_name, registration_key } = req.body || {};

  // Verify registration key matches ADMIN_REGISTRATION_SECRET
  const validKey = process.env.ADMIN_REGISTRATION_SECRET;
  if (!validKey || registration_key !== validKey) {
    return res.status(403).json({ error: 'Invalid registration key' });
  }

  if (!email?.trim() || !password || !display_name?.trim()) {
    return res.status(400).json({ error: 'Email, password, and display name are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if admin already exists
    const { data: existing, error: checkError } = await supabase
      .from('admin_users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (checkError) throw checkError;
    if (existing) {
      return res.status(409).json({ error: 'Admin account with this email already exists' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create admin account
    const { data: newAdmin, error: createError } = await supabase
      .from('admin_users')
      .insert({
        email: email.trim().toLowerCase(),
        display_name: display_name.trim(),
        password_hash,
        is_active: true
      })
      .select('id, email, display_name')
      .single();

    if (createError) throw createError;

    // Create auth token
    const token = createAdminToken(newAdmin);

    return res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      token,
      admin: { id: newAdmin.id, email: newAdmin.email, display_name: newAdmin.display_name }
    });
  } catch (error) {
    if (error.message === 'Missing ADMIN_JWT_SECRET') {
      return res.status(503).json({ error: 'Admin system not configured' });
    }
    console.error('Admin registration error:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }
}
