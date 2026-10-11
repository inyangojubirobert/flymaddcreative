// Shared helpers for digital products (pages/api/digital/**, pages/api/admin/digital/**).

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { mediaPreviewUrl, pdfPageUrl, privateDownloadUrl, watermarkText } from './digitalMedia';

export const digitalDb = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/** Emergency stop for digital sales (default off). */
export const digitalSalesPaused = () => process.env.DIGITAL_SALES_PAUSED === 'true';

export async function digitalSettings() {
  const { data } = await digitalDb.from('digital_settings').select('*').eq('id', 1).maybeSingle();
  return data || { store_fee_percent: 15, commission_percent: 5, hold_hours: 72, offline_days: 30, max_devices: 3 };
}

/** Public product description + previews (never full content). */
export function publicDigitalProduct(product, tier, assets) {
  // Published products show only approved files; the seller's own draft view shows everything not removed.
  const live = assets
    .filter((a) => (product.status === 'published' ? a.status === 'approved' : a.status !== 'removed'))
    .sort((a, b) => a.position - b.position);
  const first = live[0];
  let preview = null;
  try {
    if (product.kind === 'ebook' && first?.kind === 'epub' && product.preview_pages > 0) {
      const sections = Array.isArray(first.preview_sections) ? first.preview_sections : [];
      preview = sections.length ? { type: 'sections', sections: sections.slice(0, product.preview_pages) } : null;
    } else if (product.kind === 'ebook' && first && product.preview_pages > 0) {
      preview = {
        type: 'pages',
        pages: Array.from({ length: Math.min(product.preview_pages, first.pages || 0) }, (_, i) =>
          pdfPageUrl(first, i + 1, { width: 900, watermark: 'OneDream-PREVIEW' })),
      };
    } else if (first && product.preview_seconds > 0) {
      preview = { type: product.kind === 'audio' ? 'audio' : 'video', url: mediaPreviewUrl(first, product.preview_seconds), seconds: product.preview_seconds };
    }
  } catch {
    preview = null;
  }
  return {
    item_id: product.item_id,
    kind: product.kind,
    status: product.status,
    seller_username: product.seller_username,
    price_usd: tier ? Number(tier.price_usd) : null,
    tier_id: product.tier_id,
    google_play_product_id: tier?.is_active ? tier.google_play_product_id : null,
    in_subscription: product.in_subscription !== false,
    contents: live.map((a) => ({ id: a.id, title: a.title, position: a.position, kind: a.kind, pages: a.pages, duration_seconds: a.duration_seconds === null ? null : Number(a.duration_seconds), bytes: Number(a.bytes) })),
    preview,
  };
}

/** Licensed access to one asset for one buyer. */
export function assetAccess(asset, buyerUsername) {
  if (asset.kind === 'epub') {
    return { type: 'epub', url: privateDownloadUrl(asset, 6 * 3600), format: 'epub', expires_in_seconds: 6 * 3600, watermark: `Licensed to @${buyerUsername || 'buyer'} · One Dream` };
  }
  if (asset.kind === 'pdf') {
    const watermark = watermarkText(buyerUsername);
    return {
      type: 'pages',
      pages: Array.from({ length: asset.pages || 0 }, (_, i) => pdfPageUrl(asset, i + 1, { width: 1400, watermark })),
    };
  }
  return { type: asset.kind, url: privateDownloadUrl(asset, 6 * 3600), format: asset.format, expires_in_seconds: 6 * 3600 };
}

/**
 * Key for an offline copy, derived per licence (or subscription + item) and
 * device, so a copied file is useless on another device or account. The app
 * keeps it in the device keystore (SecureStore) and deletes it with the copy.
 */
export function offlineKey(scope, deviceId) {
  const secret = process.env.DIGITAL_OFFLINE_SECRET
    || crypto.createHash('sha256').update(`digital-offline|${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`).digest('hex');
  if (!process.env.DIGITAL_OFFLINE_SECRET && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('offline_keys_not_configured');
  return crypto.createHmac('sha256', secret).update(`onedream-offline-v1|${scope}|${deviceId}`).digest('base64');
}

export const DIGITAL_ERRORS = {
  device_limit: [409, 'This licence is already on the maximum number of devices'],
  license_inactive: [403, 'This licence is no longer active'],
  license_not_found: [404, 'Licence not found'],
};

export function digitalError(error) {
  const key = Object.keys(DIGITAL_ERRORS).find((code) => String(error?.message || '').includes(code));
  return key ? { status: DIGITAL_ERRORS[key][0], error: DIGITAL_ERRORS[key][1] } : null;
}
