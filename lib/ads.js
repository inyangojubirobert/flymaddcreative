// Shared helpers for the advertising & listing boost API (pages/api/ads/**,
// pages/api/admin/ads/**). Business rules live in SQL functions
// (supabase/add_advertising.sql); these helpers shape data for clients.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { adDeliveryUrl } from './cloudinaryAds';
import { packagePurchasable, promotionalBillingPaused } from './adsGooglePlay';

export const adsDb = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/** Terms copied onto an entitlement so later package edits never change a purchase. */
export function packageSnapshot(pkg) {
  return {
    id: pkg.id,
    kind: pkg.kind,
    name: pkg.name,
    price_usd: Number(pkg.price_usd),
    duration_hours: pkg.duration_hours,
    max_creatives: pkg.max_creatives,
    placements: pkg.placements,
    priority: pkg.priority,
    allow_external_link: pkg.allow_external_link,
  };
}

export function publicPackage(pkg) {
  const purchasable = packagePurchasable(pkg);
  return {
    id: pkg.id,
    kind: pkg.kind,
    name: pkg.name,
    tagline: pkg.tagline,
    price_usd: Number(pkg.price_usd),
    duration_hours: pkg.duration_hours,
    max_creatives: pkg.max_creatives,
    placements: pkg.placements,
    priority: pkg.priority,
    allow_external_link: pkg.allow_external_link,
    benefits: Array.isArray(pkg.benefits) ? pkg.benefits : [],
    highlight: pkg.highlight,
    // Server side: active + product id + not paused. The app additionally
    // requires Google Play to return the product before enabling "Buy".
    purchasable,
    google_play_product_id: purchasable ? pkg.google_play_product_id : null,
    // Web app: card checkout through Paystack (lib/adsPaystack.js), no Play product needed.
    card_purchasable: !!pkg.is_active && !promotionalBillingPaused(),
  };
}

export function billingStatus() {
  return { enabled: !promotionalBillingPaused(), paused: promotionalBillingPaused(), provider: 'google_play', card: !!process.env.PAYSTACK_SECRET_KEY };
}

export function mediaView(media, { previews = true } = {}) {
  let url = null;
  let poster = null;
  if (previews) {
    try {
      url = adDeliveryUrl(media);
      poster = media.resource_type === 'video' ? adDeliveryUrl(media, { poster: true, width: 720 }) : null;
    } catch {
      // Cloudinary not configured - metadata still useful.
    }
  }
  return {
    id: media.id,
    resource_type: media.resource_type,
    format: media.format,
    bytes: Number(media.bytes),
    width: media.width,
    height: media.height,
    duration_seconds: media.duration_seconds === null ? null : Number(media.duration_seconds),
    status: media.status,
    reject_reason: media.reject_reason,
    created_at: media.created_at,
    url,
    poster,
  };
}

/** Derived display state: an active campaign past its end date is "completed". */
export function campaignState(campaign, now = Date.now()) {
  if (campaign.status === 'active' && campaign.ends_at && new Date(campaign.ends_at).getTime() <= now) return 'completed';
  return campaign.status;
}

/** Stable, non-reversible viewer key for impression/click de-duplication. */
export function viewerKey(req) {
  const supplied = String(req.headers['x-ad-viewer'] || '').slice(0, 128);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const raw = supplied.length >= 16 ? `device:${supplied}` : `net:${ip}|${req.headers['user-agent'] || ''}`;
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET || 'ads'}:${raw}`).digest('hex').slice(0, 40);
}

export const AD_ERROR_MESSAGES = {
  campaign_not_found: 'Campaign not found',
  campaign_not_submittable: 'This campaign cannot be submitted in its current state',
  entitlement_invalid: 'The package for this campaign is no longer valid',
  media_invalid: 'One of the selected creatives is not available',
  too_many_creatives: 'Too many creatives for this package',
  creative_required: 'Add at least one image or video',
  external_link_not_allowed: 'This package does not include external links',
  destination_unchecked: 'The destination link has not been verified yet',
  destination_stale: 'The destination link was last checked over 7 days ago - re-check it first',
  listing_not_owned_or_inactive: 'Choose one of your own live listings',
  campaign_not_pending: 'This campaign is not waiting for review',
  media_not_approved: 'Approve every creative before approving the campaign',
  placements_full: 'All placements for this package are full right now',
  campaign_not_suspendable: 'Only live or pending campaigns can be suspended',
  campaign_not_suspended: 'This campaign is not suspended',
  invalid_action: 'Unknown action',
  campaign_expired: 'This campaign has already ended',
  live_boost_locked: 'A live boost cannot be changed',
  extension_too_long: 'Compensation would exceed the package duration',
  campaign_not_started: 'This campaign has not started',
  note_required: 'A note is required',
  media_not_found: 'Media not found',
};

export function adErrorMessage(error) {
  const key = Object.keys(AD_ERROR_MESSAGES).find((code) => String(error?.message || '').includes(code));
  return key ? AD_ERROR_MESSAGES[key] : null;
}
