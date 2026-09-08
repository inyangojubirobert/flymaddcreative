import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { createAdminToken } from '../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('id, email, display_name, password_hash, is_active')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (error) throw error;
    if (!admin || !admin.is_active || !admin.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = createAdminToken(admin);
    return res.status(200).json({
      success: true,
      token,
      admin: { id: admin.id, email: admin.email, display_name: admin.display_name }
    });
  } catch (error) {
    if (error.message === 'Missing ADMIN_JWT_SECRET') {
      return res.status(503).json({ error: 'Admin login is not configured' });
    }
    console.error('Admin login error:', error);
    return res.status(500).json({ error: 'Admin login failed' });
  }
}
