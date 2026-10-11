// Cloudinary storage for digital products (e-books, audio, video).
//
// Files are uploaded with a server-signed request into the seller's own
// folder as PRIVATE ("authenticated") assets - they are never publicly
// delivered. Buyers get:
//   * PDF   -> each page rendered as an image with the buyer's username
//              watermarked into it (signed URL per buyer + page)
//   * EPUB  -> stored as a private raw file; time-limited download, rendered
//              by the app's reader (scripts disabled) with a watermark line
//   * audio/video -> time-limited download URLs (Cloudinary private download API)
// Previews (first pages / first seconds) are signed URLs anyone may view.

import crypto from 'crypto';
import { cloudinaryConfig, signParams } from './cloudinaryAds';

export const DIGITAL_RULES = {
  pdf: { resourceType: 'image', formats: ['pdf'], maxBytes: 50 * 1024 * 1024, maxPages: 300 },
  epub: { resourceType: 'raw', formats: ['epub'], maxBytes: 50 * 1024 * 1024 },
  audio: { resourceType: 'video', formats: ['mp3', 'm4a', 'aac', 'wav'], maxBytes: 100 * 1024 * 1024, maxSeconds: 3 * 3600 },
  video: { resourceType: 'video', formats: ['mp4', 'mov', 'webm'], maxBytes: 200 * 1024 * 1024, maxSeconds: 3 * 3600 },
};

export const KIND_ASSETS = { ebook: ['pdf', 'epub'], audio: ['audio'], video: ['video'] };

export const digitalFolder = (ownerId) => `onedream_digital/${ownerId}`;

export function signDigitalUpload(ownerId, assetKind) {
  const rules = DIGITAL_RULES[assetKind];
  if (!rules) throw new Error('invalid_asset_kind');
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const params = {
    allowed_formats: rules.formats.join(','),
    folder: digitalFolder(ownerId),
    // Raw files keep their extension in the public id (Cloudinary reports no format for them).
    public_id: `dg_${crypto.randomBytes(12).toString('hex')}${rules.resourceType === 'raw' ? `.${rules.formats[0]}` : ''}`,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'authenticated',
  };
  return {
    upload_url: `https://api.cloudinary.com/v1_1/${cloudName}/${rules.resourceType}/upload`,
    resource_type: rules.resourceType,
    api_key: apiKey,
    signature: signParams(params, apiSecret),
    ...params,
    max_bytes: rules.maxBytes,
    max_seconds: rules.maxSeconds || null,
  };
}

/** Re-reads an upload from Cloudinary, including page count and duration. */
export async function getDigitalResource(resourceType, publicId) {
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const path = publicId.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/authenticated/${path}?pages=true&media_metadata=true`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` },
  });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `cloudinary_${response.status}`);
  return data;
}

export function validateDigitalResource(resource, ownerId, assetKind) {
  const rules = DIGITAL_RULES[assetKind];
  if (!resource || !rules) return { ok: false, reason: 'Upload not found' };
  if (!String(resource.public_id || '').startsWith(`${digitalFolder(ownerId)}/`)) return { ok: false, reason: 'Upload does not belong to you' };
  if (resource.type !== 'authenticated') return { ok: false, reason: 'Upload was not made through the digital product uploader' };
  if (resource.resource_type !== rules.resourceType) return { ok: false, reason: 'Unexpected file type' };
  const format = String(resource.format || (rules.resourceType === 'raw' ? String(resource.public_id).split('.').pop() : '')).toLowerCase();
  if (!rules.formats.includes(format)) return { ok: false, reason: `Only ${rules.formats.join(', ')} files are accepted` };
  if (!(resource.bytes > 0) || resource.bytes > rules.maxBytes) return { ok: false, reason: `File must be under ${Math.round(rules.maxBytes / 1024 / 1024)} MB` };
  if (assetKind === 'pdf') {
    const pages = Number(resource.pages);
    if (!(pages >= 1) || pages > rules.maxPages) return { ok: false, reason: `PDFs must have 1-${rules.maxPages} pages` };
  } else if (assetKind === 'epub') {
    // Contents are checked separately (lib/digitalEpub.js) after download.
  } else {
    const seconds = Number(resource.duration);
    if (!(seconds > 0) || seconds > rules.maxSeconds) return { ok: false, reason: 'Media must be at most 3 hours long' };
  }
  return {
    ok: true,
    asset: {
      cloudinary_public_id: resource.public_id,
      resource_type: rules.resourceType,
      format,
      bytes: resource.bytes,
      pages: assetKind === 'pdf' ? Number(resource.pages) : null,
      duration_seconds: ['pdf', 'epub'].includes(assetKind) ? null : Math.round(Number(resource.duration) * 100) / 100,
    },
  };
}

/** Signed (unguessable) delivery URL for a private asset with a transformation. */
function signedUrl(resourceType, transformation, publicId, ext) {
  const { apiSecret, cloudName } = cloudinaryConfig();
  const path = `${transformation}/${publicId}.${ext}`;
  const signature = crypto.createHash('sha1').update(path + apiSecret).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').slice(0, 8);
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/authenticated/s--${signature}--/${path}`;
}

/** Text safe for a Cloudinary text overlay without extra escaping. */
export function watermarkText(username) {
  return `OneDream-${String(username || 'buyer').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'buyer'}`;
}

/** One PDF page as an image, watermarked for this buyer (or "PREVIEW"). */
export function pdfPageUrl(asset, page, { width = 1200, watermark } = {}) {
  const overlay = `l_text:Arial_${Math.round(width / 40)}_bold:${watermark},co_rgb:808080,o_40,g_south_east,x_${Math.round(width / 40)},y_${Math.round(width / 40)}`;
  return signedUrl('image', `pg_${page},w_${width},c_limit,q_auto/${overlay}`, asset.cloudinary_public_id, 'jpg');
}

/** First N seconds of an audio/video file (preview). */
export function mediaPreviewUrl(asset, seconds) {
  return asset.resource_type === 'video' && ['mp3', 'm4a', 'aac', 'wav'].includes(asset.format)
    ? signedUrl('video', `du_${seconds}`, asset.cloudinary_public_id, 'mp3')
    : signedUrl('video', `du_${seconds},q_auto`, asset.cloudinary_public_id, 'mp4');
}

/**
 * Time-limited download of the original file (Cloudinary private download
 * API). Used for licensed audio/video streaming and offline download.
 */
export function privateDownloadUrl(asset, expiresInSeconds = 6 * 3600) {
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const params = {
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    ...(asset.resource_type === 'raw' ? {} : { format: asset.format }),
    public_id: asset.cloudinary_public_id,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'authenticated',
  };
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: apiKey, signature: signParams(params, apiSecret) });
  return `https://api.cloudinary.com/v1_1/${cloudName}/${asset.resource_type}/download?${query}`;
}
