// Shared merchant JWT verification for pages/api/merchants/**.
// Every merchant-scoped route (dashboard, links, withdraw, profile update)
// must call requireMerchant() and confirm the decoded merchant id matches
// the merchant id the route is acting on - these endpoints previously
// trusted req.query.id/linkId with no auth check at all, so anyone who knew
// or guessed a merchant's UUID could view their dashboard, hijack their
// payout wallet, or trigger a withdrawal.

import jwt from 'jsonwebtoken';
import { getJwtSecret } from './jwtSecret';

/**
 * Verifies the `Authorization: Bearer <token>` header on `req`.
 * On failure, writes the 401 response and returns null - callers should
 * `return` immediately when this happens.
 * On success, returns the decoded token payload ({ id, email, type }).
 */
export function requireMerchant(req, res) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (decoded.type !== 'merchant') {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return null;
    }
    return decoded;
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return null;
  }
}

/**
 * Convenience wrapper for the common case: this route only operates on the
 * merchant named by `merchantId` (usually req.query.id). Verifies the token
 * AND that it belongs to that exact merchant. Writes 401/403 and returns
 * null on failure - callers should `return` immediately when this happens.
 */
export function requireMerchantOwnership(req, res, merchantId) {
  const decoded = requireMerchant(req, res);
  if (!decoded) return null;

  if (decoded.id !== merchantId) {
    res.status(403).json({ success: false, error: 'Not authorized for this merchant account' });
    return null;
  }

  return decoded;
}
