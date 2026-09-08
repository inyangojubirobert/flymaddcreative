// Merchant API calls. Deliberately targets ONLY the literal-file routes
// under pages/api/merchants/[id]/*.js and links/[linkId].js - the API audit
// confirmed pages/api/merchant/* and pages/api/merchants/index.js /
// [...slug].js are dead, duplicate, or unauthenticated legacy routes.

import { apiFetch } from '../lib/api-client';

export type Merchant = {
  id: string;
  merchant_name: string;
  email: string;
  company_name?: string | null;
  wallet_address?: string | null;
  total_tokens_earned?: number;
  available_tokens?: number;
  status?: string;
  created_at?: string;
};

export type ReferralLink = {
  id: string;
  link_code: string;
  full_link: string;
  description?: string;
  is_active: boolean;
  clicks_count?: number;
  registrations_count?: number;
  created_at: string;
};

export async function registerMerchant(input: {
  merchant_name: string;
  email: string;
  company_name?: string;
  wallet_address?: string;
  password: string;
}): Promise<{ merchant: Merchant; token: string; referral_link: ReferralLink | null }> {
  const data = await apiFetch<{ success: boolean; merchant: Merchant & { token: string }; referral_link: ReferralLink | null }>(
    '/api/merchants/register',
    { method: 'POST', body: input }
  );
  const { token, ...merchant } = data.merchant;
  return { merchant, token, referral_link: data.referral_link };
}

export async function loginMerchant(input: { email: string; password: string }): Promise<{ merchant: Merchant; token: string; referral_links: ReferralLink[] }> {
  const data = await apiFetch<{ success: boolean; merchant: Merchant & { token: string }; referral_links: ReferralLink[] }>(
    '/api/merchants/login',
    { method: 'POST', body: input }
  );
  const { token, ...merchant } = data.merchant;
  return { merchant, token, referral_links: data.referral_links };
}

export type MerchantDashboard = {
  merchant: Merchant;
  stats: {
    total_referrals: number;
    pending_votes: number;
    completed_votes: number;
    total_clicks: number;
    conversion_rate: number;
    total_tokens_earned: number;
    available_tokens: number;
    pending_tokens: number;
  };
  referral_links: ReferralLink[];
  recent_activity: {
    participant: { id: string; name: string; email: string };
    registered_date: string;
    link_used?: string;
    reward: { tokens: number; status: string; created_at: string; paid_at?: string } | null;
  }[];
};

// This call also doubles as the merchant session-verify step (see
// MerchantAuthContext) - there's no separate /me endpoint that works.
export async function getMerchantDashboard(token: string, merchantId: string): Promise<MerchantDashboard> {
  return apiFetch(`/api/merchants/${merchantId}/dashboard`, { token });
}

export async function createReferralLink(token: string, merchantId: string, description?: string): Promise<ReferralLink> {
  const data = await apiFetch<{ success: boolean; link: ReferralLink }>(
    `/api/merchants/${merchantId}/links`,
    { method: 'POST', token, body: { description } }
  );
  return data.link;
}

export async function toggleReferralLink(token: string, linkId: string, isActive: boolean): Promise<ReferralLink> {
  const data = await apiFetch<{ success: boolean; link: ReferralLink }>(
    `/api/merchants/links/${linkId}`,
    { method: 'PATCH', token, body: { is_active: isActive } }
  );
  return data.link;
}

export async function withdrawMerchantTokens(token: string, merchantId: string, amount: number): Promise<{ withdrawal: { amount: number; wallet: string; status: string } }> {
  return apiFetch(`/api/merchants/${merchantId}/withdraw`, { method: 'POST', token, body: { amount } });
}

export async function updateMerchantProfile(
  token: string,
  merchantId: string,
  input: { merchant_name?: string; company_name?: string; wallet_address?: string }
): Promise<Merchant> {
  const data = await apiFetch<{ success: boolean; merchant: Merchant }>(
    `/api/merchants/${merchantId}`,
    { method: 'PATCH', token, body: input }
  );
  return data.merchant;
}
