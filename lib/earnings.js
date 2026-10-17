// Shared I/O for partner & creator earnings, the affiliate marketplace and
// payouts (pages/api/earnings/**, pages/api/affiliate/**,
// pages/api/admin/earnings/**). Rules: lib/earningsRules.js. Schema and the
// money-safe SQL functions:
//   supabase/add_earnings_and_payouts.sql
//   supabase/add_gift_revenue_sharing.sql
//   supabase/add_affiliate_marketplace.sql
//
// Activation gates live in the earnings_settings row (all off by default):
// gift_earnings_enabled, payouts_enabled, seller_funded_settlement_enabled (P1),
// resale_checkout_enabled (P3). PAYOUTS_PROVIDER_LIVE must also be "true"
// before the API lets anyone request a withdrawal.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { getJwtSecret } from './jwtSecret';
import { EARNING_SOURCES, affiliateErrorReply, emailHash, newLinkCode, signAttributionToken, verifyAttributionToken, visitorHash } from './earningsRules';

export const earningsDb = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function getEarningsSettings() {
  return must(await earningsDb.from('earnings_settings').select('*').eq('id', true).single());
}

/** Payouts need both the database switch and the deployment switch. */
export function payoutsLiveInDeployment() {
  return process.env.PAYOUTS_PROVIDER_LIVE === 'true';
}

/** Secret for signed attribution tokens. Falls back to a value derived from the JWT secret. */
export function attributionSecret() {
  if (process.env.AFFILIATE_TOKEN_SECRET) return process.env.AFFILIATE_TOKEN_SECRET;
  return crypto.createHash('sha256').update(`affiliate:${getJwtSecret()}`).digest('hex');
}

/**
 * Who is calling: a participant (onedream token) or a merchant (merchant
 * token). Writes 401 and returns null when neither. A participant linked to a
 * merchant account also carries `merchant_id`.
 */
export async function requireParty(req, res) {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return null;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, getJwtSecret());
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
  if (decoded.type === 'onedream' && decoded.userId) {
    const participant = must(await earningsDb.from('participants').select('id, username, name, email, created_at').eq('id', decoded.userId).maybeSingle());
    if (!participant) { res.status(401).json({ error: 'Participant not found' }); return null; }
    const link = must(await earningsDb.from('merchant_participant_links').select('merchant_id').eq('participant_id', participant.id).maybeSingle());
    return { party_type: 'participant', party_id: participant.id, participant, merchant_id: link?.merchant_id || null };
  }
  if (decoded.type === 'merchant' && decoded.id) {
    const merchant = must(await earningsDb.from('referral_merchants').select('id, merchant_name, email, status').eq('id', decoded.id).maybeSingle());
    if (!merchant) { res.status(401).json({ error: 'Merchant not found' }); return null; }
    const link = must(await earningsDb.from('merchant_participant_links').select('participant_id').eq('merchant_id', merchant.id).maybeSingle());
    return { party_type: 'merchant', party_id: merchant.id, merchant, merchant_id: merchant.id, linked_participant_id: link?.participant_id || null };
  }
  res.status(401).json({ error: 'Invalid token' });
  return null;
}

/** Verifies a merchant token string (used when a participant links their merchant account). */
export function verifyMerchantToken(token) {
  try {
    const decoded = jwt.verify(String(token || ''), getJwtSecret());
    return decoded.type === 'merchant' && decoded.id ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Balances for one party, one row per source AND currency (micro units of that
 * currency): [{ source, currency, pending, available, reserved, paid }].
 * Every source always appears in USD (zeroes) so the app can list it.
 */
export async function balancesFor(partyType, partyId) {
  const rows = must(await earningsDb.rpc('partner_balances', { p_party_type: partyType, p_party_id: partyId })) || [];
  const out = rows.map((row) => ({
    source: row.source, currency: row.currency || 'USD',
    pending: Number(row.pending), available: Number(row.available), reserved: Number(row.reserved), paid: Number(row.paid),
  }));
  for (const source of EARNING_SOURCES) {
    if (!out.some((r) => r.source === source)) out.push({ source, currency: 'USD', pending: 0, available: 0, reserved: 0, paid: 0 });
  }
  return out;
}

export async function auditEarnings(adminId, action, targetType, targetId, details = {}) {
  const { error } = await earningsDb.from('earnings_admin_audit')
    .insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId ? String(targetId) : null, details });
  if (error) console.error('earnings audit failed:', error.message);
}

export async function partnerForParticipant(participantId) {
  return must(await earningsDb.from('affiliate_partners').select('*').eq('participant_id', participantId).maybeSingle());
}

/** Requires an active partner account for the calling participant (writes 403 otherwise). */
export async function requirePartner(req, res, party) {
  if (party.party_type !== 'participant') { res.status(403).json({ error: 'Sign in with your One Dream account' }); return null; }
  const partner = await partnerForParticipant(party.party_id);
  if (!partner) { res.status(404).json({ error: 'Join the partner programme first', code: 'not_partner' }); return null; }
  if (partner.status !== 'active') { res.status(403).json({ error: 'Your partner account is suspended' }); return null; }
  return partner;
}

/** Runs the server-side matching and lifecycle jobs; cheap enough to call opportunistically. */
export async function runAffiliateJobs() {
  const matched = must(await earningsDb.rpc('affiliate_match_intents', { p_limit: 200 }));
  const advanced = must(await earningsDb.rpc('affiliate_advance', { p_limit: 500 }));
  return { ...matched, ...advanced };
}

export async function ensureStorefrontLink(partnerId) {
  const existing = must(await earningsDb.from('affiliate_links').select('*').eq('partner_id', partnerId).eq('target', 'storefront').limit(1));
  if (existing.length) return existing[0];
  return createAffiliateLink({ partner_id: partnerId, target: 'storefront' });
}

export async function createAffiliateLink(row) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await earningsDb.from('affiliate_links').insert({ ...row, code: newLinkCode() }).select('*').single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('link_code_collision');
}

/** Records a click and returns { click, token } or { reply } for a known refusal. */
export async function recordAffiliateClick(code, itemId, visitor) {
  const { data, error } = await earningsDb.rpc('affiliate_record_click', {
    p_code: code, p_item: itemId || null, p_visitor_hash: visitorHash(visitor, attributionSecret()),
  });
  if (error) {
    const reply = affiliateErrorReply(error.message);
    if (reply) return { reply };
    throw error;
  }
  return { click: data, token: signAttributionToken({ clickId: data.click_id, itemId: data.item_id }, attributionSecret()) };
}

/**
 * Verifies attribution tokens and records a pre-payment intent for a payment
 * reference. Returns { recorded, already_recorded?, reason? }. Used by the
 * buyer's device (pages/api/affiliate/intent.js) and, once P5 is applied, by
 * the payment-intent routes themselves.
 */
export async function recordIntentFromTokens({ paymentRef, method, buyerEmail, tokens }) {
  const settings = await getEarningsSettings();
  const maxAge = settings.affiliate_attribution_days * 86400e3;
  const secret = attributionSecret();
  const clickIds = [...new Set((tokens || []).slice(0, 20).map((t) => verifyAttributionToken(t, secret, maxAge)).filter(Boolean).map((t) => t.clickId))];
  if (!clickIds.length) return { recorded: false, reason: 'no_valid_tokens' };
  const { data, error } = await earningsDb.rpc('affiliate_record_intent', {
    p_payment_ref: paymentRef, p_method: method, p_email_hash: buyerEmail ? emailHash(buyerEmail) : null, p_click_ids: clickIds,
  });
  if (error) {
    if (String(error.message).includes('no_valid_clicks')) return { recorded: false, reason: 'no_valid_clicks' };
    throw error;
  }
  return { recorded: !data.already_recorded, already_recorded: !!data.already_recorded };
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online').replace(/\/$/, '');
}

export { must };
