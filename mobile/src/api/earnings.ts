import { Platform } from 'react-native';

import { ApiError, apiFetch } from '../lib/api-client';

// Partner & creator earnings, the affiliate marketplace and payouts -
// pages/api/earnings/** and pages/api/affiliate/**. Amounts are integer USD
// millionths ("micro"); format with formatMicro().

export type Source = 'gift_recipient' | 'gift_referral' | 'affiliate' | 'resale' | 'referral';
export type Buckets = { pending: number; available: number; reserved: number; paid: number };
export type EarningsCurrency = 'USD' | 'NGN';
export type BalanceRow = Buckets & { source: Source; currency: EarningsCurrency };

export const SOURCE_LABELS: Record<Source, string> = {
  gift_recipient: 'Gifts received',
  gift_referral: 'Gift referrals',
  affiliate: 'Affiliate commission',
  resale: 'Reseller margin',
  referral: 'Seller & buyer referrals',
};
export const MERCHANT_SOURCES: Source[] = ['gift_referral', 'referral'];

const SYMBOLS: Record<string, string> = { USD: '$', NGN: '₦' };
/** Ledger amounts are millionths of their currency. */
export function formatMicro(micro: number | null | undefined, currency: string = 'USD') {
  const value = Number(micro || 0) / 1e6;
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${value < 0 ? '-' : ''}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export type EarningsSummary = {
  party: { type: 'participant' | 'merchant'; id: string; participant_id: string | null; merchant_id: string | null; partner_handle: string | null };
  settings: {
    gift_earnings_enabled: boolean; payouts_open: boolean; min_payout_micro: number;
    gift_recipient_percent: number; gift_merchant_percent: number; gift_merchant_months: number; gift_value_basis: 'net' | 'gross';
    seller_funded_settlement_enabled: boolean; resale_checkout_enabled: boolean;
  };
  balances: { participant?: BalanceRow[]; merchant?: BalanceRow[] };
  gift_earnings: { id: string; created_at: string; status: string; gift: string; quantity: number; from: string | null; recipient_micro: number; reconciled: boolean; withdrawable: boolean }[];
  gift_referrals: { id: string; created_at: string; status: string; recipient: string; merchant_micro: number; withdrawable: boolean }[];
  referred_recipients: { username: string; registered_at: string; gift_share_until: string; active: boolean }[];
  attributions: { id: string; title: string | null; model: string; funding: string; source: string; commission_micro: number; currency?: EarningsCurrency; status: string; status_reason: string | null; created_at: string }[];
  referral_rewards: { id: string; kind: 'seller' | 'buyer'; amount_micro: number; currency?: EarningsCurrency; status: string; created_at: string }[];
  payouts: { id: string; party_type: string; source: Source; amount_micro: number; currency?: EarningsCurrency; status: string; external_reference: string | null; failure_reason: string | null; created_at: string }[];
  payees: Payee[];
  ledger: { id: number; party_type: string; source: Source; bucket: string; amount_micro: number; entry_type: string; note: string | null; created_at: string }[];
};

export type Payee = {
  party_type?: 'participant' | 'merchant';
  legal_name: string; country: string; date_of_birth: string; payout_method: string;
  payout_details: Record<string, string>; kyc_status?: 'submitted' | 'verified' | 'rejected'; kyc_note?: string | null;
};

export const getEarningsSummary = (token: string) => apiFetch<EarningsSummary>('/api/earnings/summary', { token });
export const savePayee = (token: string, payee: Payee & { as?: 'participant' | 'merchant' }) =>
  apiFetch<{ payee: Payee }>('/api/earnings/payee', { method: 'POST', token, body: payee });
export const requestPayout = (token: string, input: { source: Source; currency: EarningsCurrency; amount_usd: number; client_request_id: string; as?: string }) =>
  apiFetch<{ request_id: string; status: string }>('/api/earnings/payouts', { method: 'POST', token, body: input });
export const cancelPayout = (token: string, id: string) => apiFetch(`/api/earnings/payouts?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });

// --- Partner programme ---------------------------------------------------------

export type Partner = { id: string; handle: string; display_name: string; bio: string | null; avatar_url: string | null; status: string };
export const getPartner = (token: string) =>
  apiFetch<{ partner: Partner | null; merchant_link: { id: string; merchant_name: string; email: string } | null; storefront_url: string | null }>('/api/affiliate/partner', { token });
export const enrolPartner = (token: string, input: { handle: string; display_name: string; bio?: string }) =>
  apiFetch<{ partner: Partner; storefront_url: string }>('/api/affiliate/partner', { method: 'POST', token, body: input });
export const updatePartner = (token: string, input: { display_name?: string; bio?: string }) =>
  apiFetch<{ partner: Partner }>('/api/affiliate/partner', { method: 'PATCH', token, body: input });
export const linkMerchant = (token: string, merchantToken: string) =>
  apiFetch('/api/affiliate/link-merchant', { method: 'POST', token, body: { merchant_token: merchantToken } });

export type Offer = {
  id: string;
  item: { id: string; title: string; price_usd: number; image: string | null; seller_username: string; listing_type: string };
  own_listing: boolean; allow_referral: boolean; allow_storefront: boolean; allow_resale: boolean;
  funding: 'seller' | 'platform'; commission_percent: number; estimated_commission_micro: number;
  resale_floor_usd: number | null; resale_ceiling_usd: number | null; fulfilment: string; approval: 'auto' | 'manual';
  seller_funded_payable: boolean; resale_checkout_live: boolean;
  membership: { id: string; model: string; status: string; resale_price_usd: number | null } | null;
};
export const getOffers = (token: string, q = '') =>
  apiFetch<{ offers: Offer[]; attribution_days: number; partner: boolean }>(`/api/affiliate/offers?q=${encodeURIComponent(q)}`, { token });
export const joinOffer = (token: string, input: { offer_id: string; model: 'referral' | 'storefront' | 'resale'; resale_price_usd?: number }) =>
  apiFetch<{ membership_id: string; status: string }>('/api/affiliate/memberships', { method: 'POST', token, body: input });
export const setResalePrice = (token: string, membershipId: string, price: number) =>
  apiFetch('/api/affiliate/memberships', { method: 'PATCH', token, body: { membership_id: membershipId, resale_price_usd: price } });

export type Membership = {
  id: string; model: string; status: string; resale_price_usd: number | null; created_at: string;
  offer: { id: string; funding: string; commission_percent: number; status: string; item: { id: string; title: string; price_usd: number; images: string[] | null; seller_username: string } };
  links: { id: string; code: string; clicks: number }[];
  creatives: { id: string; kind: string; media_url: string | null; title: string | null; body: string | null; status: string; reject_reason: string | null }[];
};
export const getMemberships = (token: string) => apiFetch<{ memberships: Membership[] }>('/api/affiliate/memberships', { token });

export type AffiliateLink = { id: string; code: string; target: string; membership_id: string | null; collection_id: string | null; clicks: number; url: string };
export const getLinks = (token: string) => apiFetch<{ links: AffiliateLink[] }>('/api/affiliate/links', { token });
export const createLink = (token: string, input: { target: 'membership' | 'storefront' | 'collection'; membership_id?: string; collection_id?: string }) =>
  apiFetch<{ link: AffiliateLink }>('/api/affiliate/links', { method: 'POST', token, body: input });

export type Collection = { id: string; title: string; slug: string; items: { membership_id: string }[] };
export const getCollections = (token: string) => apiFetch<{ collections: Collection[] }>('/api/affiliate/collections', { token });
export const createCollection = (token: string, title: string) =>
  apiFetch<{ collection: Collection }>('/api/affiliate/collections', { method: 'POST', token, body: { title } });
export const updateCollection = (token: string, input: { id: string; add?: string[]; remove?: string[] }) =>
  apiFetch('/api/affiliate/collections', { method: 'PATCH', token, body: input });

export async function uploadCreative(
  token: string,
  membershipId: string,
  file: { uri: string; mimeType?: string | null; fileName?: string | null; type: 'image' | 'video'; file?: Blob | null },
  title?: string,
) {
  const signed = await apiFetch<{ upload_url: string; api_key: string; signature: string; allowed_formats: string; folder: string; public_id: string; timestamp: number }>(
    '/api/affiliate/creatives', { method: 'POST', token, body: { action: 'sign', resource_type: file.type } });
  const name = file.fileName || `creative-${Date.now()}.${file.type === 'video' ? 'mp4' : 'jpg'}`;
  const form = new FormData();
  if (Platform.OS === 'web') form.append('file', file.file ?? await (await fetch(file.uri)).blob(), name);
  else form.append('file', { uri: file.uri, name, type: file.mimeType || (file.type === 'video' ? 'video/mp4' : 'image/jpeg') } as never);
  for (const key of ['api_key', 'signature', 'allowed_formats', 'folder', 'public_id', 'timestamp'] as const) form.append(key, String(signed[key]));
  const response = await fetch(signed.upload_url, { method: 'POST', body: form });
  const uploaded = await response.json().catch(() => ({})) as { public_id?: string; error?: { message?: string } };
  if (!response.ok || !uploaded.public_id) throw new ApiError(uploaded.error?.message || 'Upload failed', response.status, uploaded);
  return apiFetch('/api/affiliate/creatives', { method: 'POST', token, body: { membership_id: membershipId, kind: file.type, public_id: uploaded.public_id, title } });
}
export const addTextCreative = (token: string, membershipId: string, title: string, body: string) =>
  apiFetch('/api/affiliate/creatives', { method: 'POST', token, body: { membership_id: membershipId, kind: 'text', title, body } });

// --- Seller side ---------------------------------------------------------------

export type SellerListing = {
  item: { id: string; title: string; price_usd: number; image: string | null; status: string; listing_type: string };
  offer: null | {
    id: string; allow_referral: boolean; allow_storefront: boolean; allow_resale: boolean; funding: string; commission_percent: number;
    resale_floor_usd: number | null; resale_ceiling_usd: number | null; fulfilment: string; approval: string; status: string;
    terms_version: number; seller_accepted_terms_version: number | null; reseller_responsibilities: Record<string, string>;
  };
  impact: { gross_micro: number; platform_micro: number; commission_micro: number; seller_receives_micro: number };
};
export const getSellerOffers = (token: string) =>
  apiFetch<{ listings: SellerListing[]; platform_percent: number; max_commission_percent: number; seller_funded_payable: boolean; resale_checkout_live: boolean }>(
    '/api/affiliate/seller/offers', { token });
export const saveSellerOffer = (token: string, input: Record<string, unknown>) =>
  apiFetch<{ offer: unknown; note: string | null }>('/api/affiliate/seller/offers', { method: 'POST', token, body: input });
export type SellerMembership = { id: string; model: string; status: string; resale_price_usd: number | null; created_at: string; partner: { handle: string; display_name: string }; offer: { item: { title: string } } };
export const getSellerMemberships = (token: string) => apiFetch<{ memberships: SellerMembership[] }>('/api/affiliate/seller/memberships', { token });
export const decideMembership = (token: string, membershipId: string, decision: 'approve' | 'reject' | 'revoke') =>
  apiFetch('/api/affiliate/seller/memberships', { method: 'POST', token, body: { membership_id: membershipId, decision } });

export type Engagement = {
  id: string; role: 'seller' | 'partner'; seller_username: string; brief: string; deliverables: string | null; status: string; created_at: string;
  partner: { handle: string; display_name: string } | null; service: { id: string; title: string; price_usd: number } | null; order_id: string | null;
};
export const getEngagements = (token: string) => apiFetch<{ engagements: Engagement[] }>('/api/affiliate/engagements', { token });
export const createEngagement = (token: string, input: { partner_handle?: string; seller_username?: string; brief: string; service_item_id?: string }) =>
  apiFetch('/api/affiliate/engagements', { method: 'POST', token, body: input });
export const updateEngagement = (token: string, input: { id: string; status?: string; deliverables?: string; order_id?: string }) =>
  apiFetch('/api/affiliate/engagements', { method: 'PATCH', token, body: input });

// --- Public storefront & attribution ------------------------------------------

export type StorefrontItem = {
  membership_id: string; item_id: string; title: string; description: string | null; image: string | null; listing_type: string;
  price_usd: number; sold_by: string; fulfilled_by: string;
  creatives: { kind: string; media_url: string | null; title: string | null; body: string | null }[];
};
export type Storefront = {
  partner: { handle: string; display_name: string; bio: string | null; avatar_url: string | null };
  link_code: string;
  collections: { title: string; slug: string; items: StorefrontItem[] }[];
  items: StorefrontItem[];
};
export const getStorefront = (handle: string) => apiFetch<Storefront>(`/api/affiliate/storefront/${encodeURIComponent(handle)}`);
export const recordClick = (code: string, itemId: string, visitor: string) =>
  apiFetch<{ token: string; item_id: string; expires_in_days: number }>('/api/affiliate/click', { method: 'POST', body: { code, item_id: itemId, visitor } });
export const postIntent = (input: { payment_ref: string; method: 'paystack' | 'usdt'; buyer_email?: string; tokens: string[] }) =>
  apiFetch<{ recorded: boolean }>('/api/affiliate/intent', { method: 'POST', body: input });
