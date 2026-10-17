// One Dream Storefront Promotion: sellers opt their promotional videos in
// for One Dream's EXTERNAL marketing (supabase/add_storefront_promotion.sql).
// Opt-in is per video, off by default, recorded with the exact terms
// version, their SHA-256, the consent sentence, time, IP and user agent.
// Up to US$10 of One Dream's own external ad spend per SELECTED video (a
// seller can have several selected), within a programme budget (US$1,000
// for terms v1) - never cash, a wallet balance, a Google Play product or an
// in-app ad credit.

import { createClient } from '@supabase/supabase-js';

export const promoDb = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube', 'x', 'other'];

/** The checkbox sentence the seller ticks; stored verbatim with the submission. */
export function consentSentence(version) {
  return `I agree to submit my promotional video for possible use in One Dream Initiative's external marketing and advertising campaigns, under the One Dream Storefront Promotion terms (version ${version}).`;
}

export async function currentTerms() {
  return must(await promoDb.from('promo_programme_terms').select('*').eq('is_current', true).maybeSingle());
}

/** Active listings and the listing videos a seller can submit. */
export async function sellerEligibility(username, terms) {
  const items = must(await promoDb.from('catalogue_items').select('id, title, status, promo_video_url, images')
    .eq('seller_username', username).neq('status', 'deleted')) || [];
  const active = items.filter((i) => i.status === 'active');
  const required = terms?.min_active_listings ?? 10;
  return {
    active_listings: active.length,
    required_listings: required,
    eligible: active.length >= required,
    videos: active.filter((i) => i.promo_video_url).map((i) => ({ item_id: i.id, title: i.title, video_url: i.promo_video_url, image: i.images?.[0] || null })),
  };
}

/** The seller's storefront link with campaign tracking, for One Dream's ads. */
export function trackedStorefrontLink(username, submissionId, platform) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online').replace(/\/$/, '');
  const params = new URLSearchParams({ utm_source: platform || 'social', utm_medium: 'paid_social', utm_campaign: `storefront_promo_${String(submissionId).slice(0, 8)}` });
  return `${base}/app/catalogue/${encodeURIComponent(username)}?${params}`;
}

export const PROMO_ERRORS = {
  promo_consent_immutable: [409, 'This consent record cannot be changed'],
  promo_consent_withdrawn: [409, 'Consent for this video was withdrawn. Submit it again to opt back in.'],
  promo_not_selected: [409, 'Only selected videos can have advertising spend recorded'],
  promo_spend_over_limit: [400, 'That would exceed the US$10 limit for this video'],
  promo_budget_exhausted: [400, 'That would exceed the total programme budget'],
  promo_submission_missing: [404, 'Submission not found'],
};
export function promoErrorReply(error) {
  const key = Object.keys(PROMO_ERRORS).find((k) => String(error?.message || '').includes(k));
  if (!key) return null;
  const [status, message] = PROMO_ERRORS[key];
  return { status, body: { error: message, code: key } };
}
