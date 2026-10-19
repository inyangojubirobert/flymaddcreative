// Cloudinary for advertising media. Binaries live only in Cloudinary;
// Supabase stores verified references (advertising_media).
//
// Uploads are signed by the server (the API secret never leaves it) into the
// advertiser's own folder, with a server-chosen public_id, an allow-list of
// formats and delivery type "authenticated": until an admin approves the
// asset it can only be viewed through signed URLs generated here. These
// signatures are unguessable but do NOT expire, so they are only ever given
// to the asset's owner and to admins. Approval converts the asset to public
// ("upload") delivery; withdrawing approval converts it back.
//
// Credentials: CLOUDINARY_URL = cloudinary://<api_key>:<api_secret>@<cloud_name>

import crypto from 'crypto';

export const AD_MEDIA_RULES = {
  image: { formats: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 10 * 1024 * 1024 },
  video: { formats: ['mp4', 'mov', 'webm'], maxBytes: 100 * 1024 * 1024, maxSeconds: 60 },
};

export function cloudinaryConfig() {
  const raw = process.env.CLOUDINARY_URL || '';
  const match = raw.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!match) throw new Error('cloudinary_not_configured');
  return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
}

/** Cloudinary API signature: sha1 of the sorted params + secret. */
export function signParams(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${Array.isArray(params[key]) ? params[key].join(',') : params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

export function adFolder(ownerId) {
  return `onedream_ads/${ownerId}`;
}

/** Parameters for one direct upload, valid for ~1 hour (Cloudinary's limit). */
export function signAdUpload(ownerId, resourceType) {
  const rules = AD_MEDIA_RULES[resourceType];
  if (!rules) throw new Error('invalid_resource_type');
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const params = {
    allowed_formats: rules.formats.join(','),
    folder: adFolder(ownerId),
    public_id: `ad_${crypto.randomBytes(12).toString('hex')}`,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'authenticated',
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

function authHeader() {
  const { apiKey, apiSecret } = cloudinaryConfig();
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

/** Reads an asset's real metadata from Cloudinary (never trusts the client's description). */
export async function getAdResource(resourceType, publicId, deliveryType = 'authenticated') {
  const { cloudName } = cloudinaryConfig();
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/${deliveryType}/${publicId.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { headers: { Authorization: authHeader() } });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `cloudinary_${response.status}`);
  return data;
}

/**
 * Checks an uploaded asset against the advertising rules. Returns
 * { ok: true, media } with the verified fields to store, or { ok: false, reason }.
 */
export function validateAdResource(resource, ownerId, resourceType) {
  const rules = AD_MEDIA_RULES[resourceType];
  if (!resource || !rules) return { ok: false, reason: 'Upload not found' };
  const folder = adFolder(ownerId);
  if (!String(resource.public_id || '').startsWith(`${folder}/`)) return { ok: false, reason: 'Upload does not belong to you' };
  if (resource.type !== 'authenticated') return { ok: false, reason: 'Upload was not made through the advertising uploader' };
  if (resource.resource_type !== resourceType) return { ok: false, reason: 'Unexpected media type' };
  const format = String(resource.format || '').toLowerCase();
  if (!rules.formats.includes(format)) return { ok: false, reason: `Only ${rules.formats.join(', ')} files are accepted` };
  if (!(resource.bytes > 0) || resource.bytes > rules.maxBytes) {
    return { ok: false, reason: `File must be under ${Math.round(rules.maxBytes / 1024 / 1024)} MB` };
  }
  if (resourceType === 'video') {
    const seconds = Number(resource.duration);
    if (!(seconds > 0) || seconds > rules.maxSeconds) return { ok: false, reason: `Videos must be ${rules.maxSeconds} seconds or shorter` };
  }
  return {
    ok: true,
    media: {
      cloudinary_public_id: resource.public_id,
      cloudinary_asset_id: resource.asset_id || null,
      resource_type: resourceType,
      format,
      bytes: resource.bytes,
      width: resource.width || null,
      height: resource.height || null,
      duration_seconds: resourceType === 'video' ? Math.round(Number(resource.duration) * 100) / 100 : null,
      version: resource.version || null,
    },
  };
}

async function signedPost(resourceType, action, params) {
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const body = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const form = new URLSearchParams({ ...body, api_key: apiKey, signature: signParams(body, apiSecret) });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/${action}`, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data?.error?.message || `cloudinary_${action}_failed`);
  return data;
}

/** Approval: switch from authenticated (private) to public delivery. */
export function publishAdAsset(resourceType, publicId) {
  return signedPost(resourceType, 'rename', {
    from_public_id: publicId,
    to_public_id: publicId,
    type: 'authenticated',
    to_type: 'upload',
    overwrite: 'false',
    invalidate: 'true',
  });
}

/** Withdrawn approval: back to authenticated (private) delivery, CDN cache invalidated. */
export function unpublishAdAsset(resourceType, publicId) {
  return signedPost(resourceType, 'rename', {
    from_public_id: publicId,
    to_public_id: publicId,
    type: 'upload',
    to_type: 'authenticated',
    overwrite: 'false',
    invalidate: 'true',
  });
}

export function destroyAdAsset(resourceType, publicId, deliveryType = 'authenticated') {
  return signedPost(resourceType, 'destroy', { public_id: publicId, type: deliveryType, invalidate: 'true' });
}

/**
 * Partner creatives: uploaded with authenticated (private) delivery by
 * current apps. media_url holds the unsigned ".../authenticated/<id>" form
 * until approval moves the asset to public delivery. Returns a URL the
 * owner or an admin can open (signed while private; unchanged once public).
 */
export function creativeViewUrl(creative) {
  const url = creative?.media_url;
  if (!url || !creative.cloudinary_public_id || !url.includes('/authenticated/')) return url || null;
  const { apiSecret, cloudName } = cloudinaryConfig();
  const signature = crypto.createHash('sha1').update(creative.cloudinary_public_id + apiSecret).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
  return `https://res.cloudinary.com/${cloudName}/${creative.kind}/authenticated/s--${signature}--/${creative.cloudinary_public_id}`;
}

/**
 * Delivery URL. Public assets use the normal CDN URL; private (pending) assets
 * get a signed URL so only our server can mint links to them.
 */
export function adDeliveryUrl(media, { width = 1080, poster = false } = {}) {
  const { apiSecret, cloudName } = cloudinaryConfig();
  const isVideo = media.resource_type === 'video';
  const transformation = poster
    ? `so_0,w_${width},c_limit,q_auto`
    : isVideo ? `w_${width},c_limit,q_auto,vc_auto` : `w_${width},c_limit,q_auto,f_auto`;
  const ext = poster ? 'jpg' : isVideo ? 'mp4' : media.format;
  const path = `${transformation}/${media.cloudinary_public_id}.${ext}`;
  if (media.delivery_type === 'upload') {
    return `https://res.cloudinary.com/${cloudName}/${media.resource_type}/upload/${path}`;
  }
  const signature = crypto.createHash('sha1').update(path + apiSecret).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
  return `https://res.cloudinary.com/${cloudName}/${media.resource_type}/authenticated/s--${signature}--/${path}`;
}
