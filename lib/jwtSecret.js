import jwt from 'jsonwebtoken';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    return { ...payload, id: payload.id || payload.userId };
  } catch {
    return null;
  }
}