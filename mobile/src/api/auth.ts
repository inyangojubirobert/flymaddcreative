// Participant auth calls. Deliberately targets pages/api/onedream/register.js
// and login.js only - NOT pages/api/register-participant.js, which is
// confirmed broken (throws on a missing import, and omits `type` from the
// signed JWT so every downstream auth check that requires
// decoded.type === 'onedream' rejects its tokens).

import { apiFetch } from '../lib/api-client';

export type Participant = {
  id: string;
  name: string;
  email: string;
  username: string;
  user_code: string;
  total_votes: number;
  current_stage?: string;
  created_at: string;
};

export type AuthResult = {
  participant: Participant;
  token: string;
};

export async function register(input: {
  name: string;
  email: string;
  username: string;
  password: string;
  ref_code?: string;
}): Promise<AuthResult> {
  const data = await apiFetch<{ success: boolean; participant: Participant & { token: string } }>(
    '/api/onedream/register',
    { method: 'POST', body: input }
  );
  const { token, ...participant } = data.participant;
  return { participant, token };
}

export async function login(input: { email: string; password: string }): Promise<AuthResult> {
  const data = await apiFetch<{ success: boolean; user: Participant & { token: string; voteLink: string } }>(
    '/api/onedream/login',
    { method: 'POST', body: input }
  );
  const { token, voteLink: _voteLink, ...participant } = data.user;
  return { participant, token };
}

export async function verifyToken(token: string): Promise<{ valid: boolean; userId?: string; email?: string }> {
  return apiFetch('/api/onedream/verify', { method: 'POST', token });
}
