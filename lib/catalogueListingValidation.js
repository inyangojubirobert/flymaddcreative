// Server-side validation for catalogue listing writes (pages/api/catalogue/items.js).
// Pure functions so they can be tested without a database.
//
// Checkout charges exactly price_usd for any listing that is not deleted, so
// every saved price must be a finite, positive USD amount.

export const LISTING_STATUSES = ['active', 'paused'];
export const PAYMENT_METHODS = ['paystack', 'usdt'];

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 5000;
const SIZE_MAX = 120;
const URL_MAX = 2048;
const IMAGES_MAX = 10;

// Returns the normalized href for an http(s) URL, or null. Normalizing
// percent-encodes characters such as quotes that could break out of HTML
// attributes on pages that render these links.
function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || value.length > URL_MAX) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href.length > URL_MAX ? null : url.href;
  } catch {
    return null;
  }
}

// Some public pages (e.g. vote.html) still insert listing text as HTML, so
// angle brackets are refused rather than relying on every page to escape.
const MARKUP_CHARS = /[<>]/;

function optionalText(value, max, label) {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} must be ${max} characters or fewer.` };
  if (MARKUP_CHARS.test(trimmed)) return { error: `${label} cannot contain < or >.` };
  return { value: trimmed || null };
}

export function parsePriceUsd(raw) {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const price = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(price) || price <= 0) return null;
  const cents = Math.round(price * 100) / 100;
  return cents > 0 ? cents : null;
}

/**
 * Validates the editable listing fields present in `body`.
 * `isCreate` makes title and price required.
 * Returns { payload } with normalized values, or { error }.
 * Fields that are absent from `body` are left out of `payload` (PATCH semantics).
 */
export function validateListingFields(body, { isCreate }) {
  const input = body || {};
  const payload = {};

  if (isCreate || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      return { error: 'Enter a title.' };
    }
    const title = input.title.trim();
    if (title.length > TITLE_MAX) return { error: `Title must be ${TITLE_MAX} characters or fewer.` };
    if (MARKUP_CHARS.test(title)) return { error: 'Title cannot contain < or >.' };
    payload.title = title;
  }

  if (isCreate || input.price_usd !== undefined) {
    const price = parsePriceUsd(input.price_usd);
    if (price === null) return { error: 'Enter a price above 0 USD.' };
    payload.price_usd = price;
  }

  if (input.description !== undefined) {
    const result = optionalText(input.description, DESCRIPTION_MAX, 'Description');
    if (result.error) return result;
    payload.description = result.value ?? '';
  }

  if (input.size !== undefined) {
    const result = optionalText(input.size, SIZE_MAX, 'Size');
    if (result.error) return result;
    payload.size = result.value;
  }

  if (input.promo_video_url !== undefined) {
    const result = optionalText(input.promo_video_url, URL_MAX, 'Video link');
    if (result.error) return result;
    if (result.value) {
      const href = normalizeHttpUrl(result.value);
      if (!href) return { error: 'Video link must be a web address (https://...).' };
      payload.promo_video_url = href;
    } else {
      payload.promo_video_url = null;
    }
  }

  if (input.images !== undefined) {
    if (input.images === null) {
      payload.images = [];
    } else {
      if (!Array.isArray(input.images)) return { error: 'Images must be a list of web addresses.' };
      if (input.images.length > IMAGES_MAX) return { error: `Add at most ${IMAGES_MAX} images.` };
      const images = input.images.map(normalizeHttpUrl);
      if (images.some((href) => href === null)) return { error: 'Each image must be a web address (https://...).' };
      payload.images = images;
    }
  }

  if (input.payment_methods !== undefined) {
    if (!Array.isArray(input.payment_methods) || input.payment_methods.length === 0) {
      return { error: 'Choose at least one payment method.' };
    }
    if (!input.payment_methods.every((method) => PAYMENT_METHODS.includes(method))) {
      return { error: 'Unknown payment method.' };
    }
    payload.payment_methods = [...new Set(input.payment_methods)];
  }

  if (isCreate || input.status !== undefined) {
    const status = input.status === undefined ? 'active' : input.status;
    if (!LISTING_STATUSES.includes(status)) return { error: 'Status must be active or paused.' };
    payload.status = status;
  }

  if (input.category_id !== undefined) {
    if (input.category_id === null || input.category_id === '') {
      return { error: 'Choose a category for this product.' };
    }
    if (typeof input.category_id !== 'string') return { error: 'Choose a category from the shop list.' };
    payload.category_id = input.category_id;
  } else if (isCreate) {
    return { error: 'Choose a category for this product.' };
  }

  return { payload };
}
