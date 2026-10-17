import { apiFetch } from '../lib/api-client';

// One Dream Storefront Promotion - pages/api/promo/**. Sellers opt a listing's
// promotional video in for One Dream's external social media advertising.
// Opt-in is per video and off by default.

export type PromoTerms = {
  version: number;
  title: string;
  body: string;
  min_active_listings: number;
  max_ad_spend_usd: number;
  programme_budget_usd: number;
  max_selected_per_seller: number | null;
  consent: string;
};

export type PromoSubmission = {
  id: string;
  item_id: string;
  video_url: string;
  terms_version: number;
  consent_at: string;
  status: 'submitted' | 'selected' | 'not_selected' | 'withdrawn';
  review_note: string | null;
  reviewed_at: string | null;
  withdrawn_at: string | null;
  created_at: string;
  campaigns: { platform: string; spent_on: string; campaign_url: string | null }[];
};

export type PromoOverview = {
  terms: PromoTerms;
  eligibility: {
    active_listings: number;
    required_listings: number;
    eligible: boolean;
    videos: { item_id: string; title: string; video_url: string; image: string | null }[];
  };
  submissions: PromoSubmission[];
};

export const getPromoOverview = (token: string) => apiFetch<PromoOverview>('/api/promo/submissions', { token });

export const submitPromoVideo = (token: string, input: { item_id: string; terms_version: number }) =>
  apiFetch<{ submission: PromoSubmission }>('/api/promo/submissions', { method: 'POST', token, body: { ...input, accept: true } });

export const withdrawPromoVideo = (token: string, submissionId: string, reason?: string) =>
  apiFetch<{ submission: PromoSubmission }>('/api/promo/submissions', { method: 'POST', token, body: { action: 'withdraw', submission_id: submissionId, reason } });
