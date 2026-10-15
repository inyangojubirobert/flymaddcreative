import { API_BASE_URL, ApiError, apiFetch } from '../lib/api-client';
import { getAdViewerId } from '../lib/ad-viewer';
import type { CatalogueItem } from './catalogue';

// Advertising & listing boosts - pages/api/ads/**. Packages, prices and
// durations come from the server; media goes straight to Cloudinary with a
// server-signed upload and is then verified by the server.

export type AdPackage = {
  id: string;
  kind: 'ad' | 'boost';
  name: string;
  tagline: string | null;
  price_usd: number;
  duration_hours: number;
  max_creatives: number;
  placements: string[];
  priority: number;
  allow_external_link: boolean;
  benefits: string[];
  highlight: string | null;
  purchasable: boolean;
  google_play_product_id: string | null;
  /** Web app: can be bought by card (Paystack). */
  card_purchasable?: boolean;
};

export type AdMedia = {
  id: string;
  resource_type: 'image' | 'video';
  format: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  reject_reason: string | null;
  created_at: string;
  url: string | null;
  poster: string | null;
};

export type AdEntitlement = {
  id: string;
  package_id: string;
  package: Pick<AdPackage, 'id' | 'kind' | 'name' | 'price_usd' | 'duration_hours' | 'max_creatives' | 'placements' | 'priority' | 'allow_external_link'>;
  status: 'available' | 'used' | 'refunded' | 'revoked';
  is_paid: boolean;
  provider: 'google_play' | 'paystack' | 'admin_grant';
  order_id: string | null;
  price_usd: number | null;
  revoke_reason: string | null;
  created_at: string;
};

export type CampaignState = 'draft' | 'pending_review' | 'active' | 'paused' | 'rejected' | 'suspended' | 'revoked' | 'completed';

export type AdCampaign = {
  id: string;
  kind: 'ad' | 'boost';
  package_id: string;
  entitlement_id: string;
  title: string;
  body: string | null;
  cta_label: string | null;
  destination_type: 'external' | 'listing' | 'profile';
  destination_url: string | null;
  listing_id: string | null;
  listing_title: string | null;
  placements: string[];
  status: Exclude<CampaignState, 'completed'>;
  state: CampaignState;
  starts_at: string | null;
  ends_at: string | null;
  submitted_at: string | null;
  review_note: string | null;
  created_at: string;
  media: AdMedia[];
  impressions: number;
  clicks: number;
};

export type ServedAd = {
  id: string;
  title: string;
  body: string | null;
  cta_label: string;
  destination: { type: 'external' | 'listing' | 'profile'; url: string | null; listing_id: string | null; username: string | null };
  media: { type: 'image' | 'video'; url: string; poster: string | null; width: number | null; height: number | null }[];
};

export type ServedBoost = { campaign_id: string; listing: CatalogueItem };

export type AdPlacement = 'home' | 'shop' | 'search' | 'category';

export function getAdPackages(): Promise<{ billing: { enabled: boolean; paused: boolean; provider: string }; packages: AdPackage[] }> {
  return apiFetch('/api/ads/packages');
}

export type AnalyticsRange = '7d' | '30d' | 'lifetime';

type Counts = { impressions: number; clicks: number; ctr: number | null };

export type CampaignAnalytics = {
  campaign: {
    id: string;
    kind: 'ad' | 'boost';
    title: string;
    state: CampaignState;
    review_note: string | null;
    submitted_at: string | null;
    starts_at: string | null;
    ends_at: string | null;
    /** Live: until ends_at. Paused: frozen. Not started: the purchased duration. */
    remaining_ms: number;
    counting: boolean;
    not_started?: boolean;
  };
  package: {
    id: string;
    name: string;
    duration_hours: number | null;
    max_creatives: number | null;
    placements: string[];
    priority: number;
    entry_priority: number;
    top_priority: number;
    relative_weight: number | null;
  };
  analytics: {
    range: AnalyticsRange;
    time_zone: string;
    from: string;
    to: string;
    totals: Counts;
    lifetime: Counts;
    daily: { date: string; impressions: number; clicks: number }[];
    placements: ({ placement: AdPlacement | 'other' } & Counts)[];
  };
  server_now: string;
};

/** One of your campaigns' real impressions and clicks; days follow your time zone. */
export function getCampaignAnalytics(token: string, campaignId: string, range: AnalyticsRange): Promise<CampaignAnalytics> {
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // Older JS engines without Intl time zones: fall back to UTC days.
  }
  const query = new URLSearchParams({ id: campaignId, range, tz: timeZone });
  return apiFetch(`/api/ads/campaign-analytics?${query}`, { token });
}

export function getMyAds(token: string): Promise<{ entitlements: AdEntitlement[]; campaigns: AdCampaign[] }> {
  return apiFetch('/api/ads/campaigns', { token });
}

export type CampaignInput = {
  title?: string;
  body?: string | null;
  cta_label?: string | null;
  destination_type?: 'external' | 'listing' | 'profile';
  destination_url?: string | null;
  listing_id?: string | null;
  media_ids?: string[];
};

export function createCampaign(token: string, input: CampaignInput & { entitlement_id: string }): Promise<{ id: string; status: string }> {
  return apiFetch('/api/ads/campaigns', { method: 'POST', token, body: input });
}

export function updateCampaign(token: string, id: string, input: CampaignInput): Promise<{ id: string; status: string }> {
  return apiFetch('/api/ads/campaigns', { method: 'PATCH', token, body: { id, ...input } });
}

export function deleteCampaign(token: string, id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/ads/campaigns?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

export function submitCampaign(token: string, id: string): Promise<{ status: string; message: string }> {
  return apiFetch('/api/ads/campaign-submit', { method: 'POST', token, body: { id } });
}

export async function getAdMedia(token: string): Promise<AdMedia[]> {
  const data = await apiFetch<{ media: AdMedia[] }>('/api/ads/media', { token });
  return data.media;
}

export function deleteAdMedia(token: string, id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/ads/media?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

type SignedUpload = {
  upload_url: string;
  api_key: string;
  signature: string;
  allowed_formats: string;
  folder: string;
  public_id: string;
  timestamp: number;
  type: string;
  max_bytes: number;
  max_seconds: number | null;
};

/** Signed upload straight to Cloudinary, then server verification. */
export async function uploadAdMedia(
  token: string,
  file: { uri: string; mimeType?: string | null; fileName?: string | null; fileSize?: number | null; duration?: number | null; type: 'image' | 'video' },
): Promise<AdMedia> {
  const signed = await apiFetch<SignedUpload>('/api/ads/media-sign', { method: 'POST', token, body: { resource_type: file.type } });
  if (file.fileSize && file.fileSize > signed.max_bytes) {
    throw new ApiError(`File must be under ${Math.round(signed.max_bytes / 1024 / 1024)} MB`, 400, null);
  }
  // expo-image-picker reports video duration in milliseconds.
  if (file.type === 'video' && signed.max_seconds && file.duration && file.duration / 1000 > signed.max_seconds) {
    throw new ApiError(`Videos must be ${signed.max_seconds} seconds or shorter`, 400, null);
  }

  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.fileName || `ad-${Date.now()}.${file.type === 'video' ? 'mp4' : 'jpg'}`,
    type: file.mimeType || (file.type === 'video' ? 'video/mp4' : 'image/jpeg'),
  } as never);
  for (const key of ['api_key', 'signature', 'allowed_formats', 'folder', 'public_id', 'timestamp', 'type'] as const) {
    form.append(key, String(signed[key]));
  }
  const response = await fetch(signed.upload_url, { method: 'POST', body: form });
  const uploaded = await response.json().catch(() => ({})) as { public_id?: string; error?: { message?: string } };
  if (!response.ok || !uploaded.public_id) {
    throw new ApiError(uploaded.error?.message || 'Upload failed', response.status, uploaded);
  }

  const registered = await apiFetch<{ media: AdMedia }>('/api/ads/media', {
    method: 'POST',
    token,
    body: { public_id: uploaded.public_id, resource_type: file.type },
  });
  return registered.media;
}

// --- Website card payments (Paystack) - web app only -----------------------------

export function startAdCardCheckout(token: string, input: { package_id: string; callback_url?: string }): Promise<{ authorization_url: string; reference: string; amount_ngn: number; price_usd: number }> {
  return apiFetch('/api/ads/paystack-checkout', { method: 'POST', token, body: input });
}

export function verifyAdCardCheckout(token: string, reference: string): Promise<{ success?: boolean; pending?: boolean; refunded?: boolean; error?: string; entitlement_id?: string }> {
  return apiFetch('/api/ads/paystack-verify', { method: 'POST', token, body: { reference } });
}

export function verifyAdPurchase(token: string, input: { productId: string; purchaseToken: string }): Promise<{ success: boolean; entitlement_id?: string; pending?: boolean; error?: string }> {
  return apiFetch('/api/ads/purchase-google-play', { method: 'POST', token, body: { product_id: input.productId, purchase_token: input.purchaseToken } });
}

export async function getSponsored(placement: AdPlacement, options: { ads?: number; boosts?: number; categoryId?: string | null } = {}): Promise<{ ads: ServedAd[]; boosted: ServedBoost[] }> {
  const query = new URLSearchParams({ placement, ads: String(options.ads ?? 0), boosts: String(options.boosts ?? 0) });
  if (options.categoryId) query.set('category_id', options.categoryId);
  try {
    return await apiFetch(`/api/ads/serve?${query}`);
  } catch {
    return { ads: [], boosted: [] };
  }
}

/** Fire-and-forget impression / click (de-duplicated on the server). */
export function trackAdEvent(campaignId: string, kind: 'impression' | 'click', placement: AdPlacement) {
  void getAdViewerId().then((viewer) => fetch(`${API_BASE_URL}/api/ads/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ad-Viewer': viewer },
    body: JSON.stringify({ campaign_id: campaignId, kind, placement }),
  })).catch(() => {});
}

export function formatDuration(hours: number) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '24 hours' : `${days} days`;
  }
  return `${hours} hours`;
}
