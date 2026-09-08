// Shared participant (One Dream Initiative "onedream_user") JWT verification.
// Mirrors lib/merchantAuth.js - used to prove that a request to release
// catalogue escrow funds is really coming from the seller who owns the order,
// not just anyone who knows the order id.

import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getJwtSecret } from './jwtSecret';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Verifies the `Authorization: Bearer <token>` header and resolves it to the
 * participant's username. On failure, writes the response and returns null -
 * callers should `return` immediately when this happens.
 */
export async function requireParticipant(req, res) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }

  if (decoded.type !== 'onedream' || !decoded.userId) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }

  const { data: participant, error } = await supabase
    .from('participants')
    .select('id, username, email')
    .eq('id', decoded.userId)
    .single();

  if (error || !participant) {
    res.status(401).json({ error: 'Participant not found' });
    return null;
  }

  return participant;
}
