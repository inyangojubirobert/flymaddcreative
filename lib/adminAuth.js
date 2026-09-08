// Admin-only JWT helpers. Admin accounts are stored in admin_users and have a
// separate signing secret from participant and merchant sessions.

import jwt from 'jsonwebtoken';

function getAdminJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error('Missing ADMIN_JWT_SECRET');
  return secret;
}

export function createAdminToken(admin) {
  return jwt.sign(
    { id: admin.id, email: admin.email, type: 'admin' },
    getAdminJwtSecret(),
    { expiresIn: '8h' }
  );
}

export function requireAdmin(req, res) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, getAdminJwtSecret());
    if (decoded.type !== 'admin' || !decoded.id) {
      res.status(401).json({ error: 'Invalid admin token' });
      return null;
    }
    return decoded;
  } catch (error) {
    if (error.message === 'Missing ADMIN_JWT_SECRET') {
      res.status(503).json({ error: 'Admin authentication is not configured' });
      return null;
    }
    res.status(401).json({ error: 'Invalid or expired admin token' });
    return null;
  }
}

// JWT expiry alone is not enough for payout administration: check that the
// administrator still exists and is active on every privileged request.
export async function requireActiveAdmin(req, res, supabase) {
  const tokenAdmin = requireAdmin(req, res);
  if (!tokenAdmin) return null;

  const { data: admin, error } = await supabase
    .from('admin_users')
    .select('id, email, display_name, is_active')
    .eq('id', tokenAdmin.id)
    .maybeSingle();

  if (error) {
    console.error('Admin lookup failed:', error);
    res.status(503).json({ error: 'Admin service is unavailable' });
    return null;
  }
  if (!admin || !admin.is_active) {
    res.status(403).json({ error: 'Administrator account is inactive' });
    return null;
  }
  return admin;
}
