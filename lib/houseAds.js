// House ads: One Dream's own ads, uploaded by admins (supabase/add_house_ads.sql).
// No advertiser, package or subscription involved; they never touch paid
// advertising, billing or Google Play. Media is uploaded straight to
// Cloudinary with a server signature into onedream_house_ads/ with public
// delivery (admins publish it, so there is no review step), then verified
// against Cloudinary before it is stored.

import crypto from 'crypto';
import { adsDb } from './ads';
import { AD_MEDIA_RULES, adDeliveryUrl, cloudinaryConfig, getAdResource, signParams } from './cloudinaryAds';

export const HOUSE_FOLDER = 'onedream_house_ads';
export const HOUSE_PLACEMENTS = ['home', 'shop', 'search', 'category'];

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Parameters for one direct, public upload by an admin (~1 hour). */
export function signHouseAdUpload(resourceType) {
  const rules = AD_MEDIA_RULES[resourceType];
  if (!rules) throw new Error('invalid_resource_type');
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const params = {
    allowed_formats: rules.formats.join(','),
    folder: HOUSE_FOLDER,
    public_id: `house_${crypto.randomBytes(12).toString('hex')}`,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'upload',
  };
  return {
    upload_url: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    api_key: apiKey,
    signature: signParams(params, apiSecret),
    ...params,
    max_bytes: rules.maxBytes,
    max_seconds: rules.maxSeconds || null,
  };
}

/** Reads the upload from Cloudinary and checks it against the media rules. */
export async function verifyHouseUpload(resourceType, publicId) {
  const rules = AD_MEDIA_RULES[resourceType];
  if (!rules) return { ok: false, reason: 'Choose an image or a video' };
  if (!String(publicId || '').startsWith(`${HOUSE_FOLDER}/`)) return { ok: false, reason: 'Upload it through the admin uploader' };
  const resource = await getAdResource(resourceType, publicId, 'upload');
  if (!resource) return { ok: false, reason: 'Upload not found' };
  const format = String(resource.format || '').toLowerCase();
  if (!rules.formats.includes(format)) return { ok: false, reason: `Only ${rules.formats.join(', ')} files are accepted` };
  if (!(resource.bytes > 0) || resource.bytes > rules.maxBytes) return { ok: false, reason: `File must be under ${Math.round(rules.maxBytes / 1024 / 1024)} MB` };
  if (resourceType === 'video' && !(Number(resource.duration) > 0 && Number(resource.duration) <= rules.maxSeconds)) {
    return { ok: false, reason: `Videos must be ${rules.maxSeconds} seconds or shorter` };
  }
  return {
    ok: true,
    media: {
      resource_type: resourceType,
      format,
      cloudinary_public_id: resource.public_id,
      bytes: resource.bytes,
      width: resource.width || null,
      height: resource.height || null,
      duration_seconds: resourceType === 'video' ? Math.round(Number(resource.duration) * 100) / 100 : null,
      version: resource.version || null,
    },
  };
}

/** Live house ads for a placement (active, inside their window). Never throws. */
export async function liveHouseAds(placement) {
  try {
    const now = new Date().toISOString();
    const rows = must(await adsDb.from('house_ads').select('*')
      .eq('status', 'active').lte('starts_at', now).or(`ends_at.is.null,ends_at.gt.${now}`)
      .contains('placements', [placement]).limit(40));
    return rows || [];
  } catch (error) {
    // Table not created yet, or a transient error: serve paid ads only.
    if (!['PGRST205', '42P01'].includes(error?.code)) console.error('house ads unavailable:', error.message || error);
    return [];
  }
}

/** The same shape /api/ads/serve returns for paid ads, so every app version can show it. */
export function servedHouseAd(row) {
  const media = { resource_type: row.resource_type, format: row.format, cloudinary_public_id: row.cloudinary_public_id, delivery_type: 'upload' };
  return {
    id: row.id,
    house: true,
    title: row.title,
    body: row.body,
    cta_label: row.cta_label || (row.destination_type === 'external' ? 'Visit' : 'View'),
    destination: {
      type: row.destination_type,
      url: row.destination_type === 'external' ? row.destination_url : null,
      listing_id: row.destination_type === 'listing' ? row.listing_id : null,
      username: row.destination_type === 'profile' ? row.profile_username : null,
    },
    media: [{
      type: row.resource_type,
      url: adDeliveryUrl(media),
      poster: row.resource_type === 'video' ? adDeliveryUrl(media, { poster: true, width: 720 }) : null,
      width: row.width,
      height: row.height,
    }],
  };
}

/** Preview URLs for the admin list. */
export function houseAdPreview(row) {
  return servedHouseAd(row).media[0];
}
