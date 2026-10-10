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
const LISTING_TYPES = ['product', 'service'];
const LISTING_STATUS = ['active', 'paused'];
const PRODUCT_CONDITIONS = ['new', 'used_like_new', 'used_good', 'used_fair', 'refurbished', 'not_applicable'];
const FULFILLMENT_METHODS = ['delivery', 'pickup', 'shipping', 'digital_delivery'];
const SERVICE_MODES = ['on_site', 'at_provider', 'remote'];
const DRAFT_STOCK_STATUSES = ['in_stock', 'limited', 'made_to_order', 'preorder', 'out_of_stock'];

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

function optionalEnumList(value, allowed, label, max = 5) {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > max || value.some((entry) => !allowed.includes(entry))) {
    return { error: `Choose valid ${label}.` };
  }
  return { value: [...new Set(value)] };
}

function optionalBoundedNumber(value, min, max, label, integer = true) {
  if (value === undefined) return {};
  if (value === null || value === '') return { value: null };
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min || number > max) {
    return { error: `${label} must be between ${min} and ${max}${integer ? '' : ''}.` };
  }
  return { value: number };
}

function validateDetails(value, type) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${type} details must be an object.` };

  const output = {};
  if (type === 'Product') {
    if (value.condition !== undefined) {
      if (value.condition !== null && !PRODUCT_CONDITIONS.includes(value.condition)) {
        return { error: 'Choose a valid product condition.' };
      }
      output.condition = value.condition;
    }
    for (const [key, max, label] of [['brand', 80, 'Brand'], ['sku', 60, 'SKU'], ['delivery_areas', 300, 'Delivery areas']]) {
      if (value[key] !== undefined) {
        const result = optionalText(value[key], max, label);
        if (result.error) return result;
        output[key] = result.value;
      }
    }
    const fulfillment = optionalEnumList(value.fulfillment_methods, FULFILLMENT_METHODS, 'fulfillment methods');
    if (fulfillment.error) return fulfillment;
    if (fulfillment.value !== undefined) output.fulfillment_methods = fulfillment.value;
    const dispatch = optionalBoundedNumber(value.estimated_dispatch_days, 0, 365, 'Estimated dispatch days');
    if (dispatch.error) return dispatch;
    if (dispatch.value !== undefined) output.estimated_dispatch_days = dispatch.value;
    if (Object.keys(value).some((key) => !['condition', 'brand', 'sku', 'delivery_areas', 'fulfillment_methods', 'estimated_dispatch_days'].includes(key))) {
      return { error: 'Product details contain unsupported fields.' };
    }
  } else {
    const modes = optionalEnumList(value.service_modes, SERVICE_MODES, 'service modes');
    if (modes.error) return modes;
    if (modes.value !== undefined) output.service_modes = modes.value;
    for (const [key, max, label] of [['service_area', 300, 'Service area']]) {
      if (value[key] !== undefined) {
        const result = optionalText(value[key], max, label);
        if (result.error) return result;
        output[key] = result.value;
      }
    }
    for (const [key, min, max, label] of [
      ['typical_duration_minutes', 1, 100000, 'Typical duration'],
      ['experience_years', 0, 80, 'Experience years'],
    ]) {
      const result = optionalBoundedNumber(value[key], min, max, label);
      if (result.error) return result;
      if (result.value !== undefined) output[key] = result.value;
    }
    if (Object.keys(value).some((key) => !['service_modes', 'service_area', 'typical_duration_minutes', 'experience_years'].includes(key))) {
      return { error: 'Service details contain unsupported fields.' };
    }
  }
  return { value: output };
}

function validateAttributeInputs(value) {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > 50) return { error: 'Listing attributes must be a list of up to 50 values.' };
  const normalized = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: 'Each listing attribute must be an object.' };
    const attributeId = item.attribute_id;
    const customLabel = item.custom_label;
    if ((attributeId !== undefined && (typeof attributeId !== 'string' || attributeId.length > 80))
      || (customLabel !== undefined && (typeof customLabel !== 'string' || !customLabel.trim() || customLabel.trim().length > 60 || MARKUP_CHARS.test(customLabel)))) {
      return { error: 'Choose a valid attribute or provide a short custom label.' };
    }
    if ((attributeId === undefined) === (customLabel === undefined)) {
      return { error: 'Each attribute needs either a configured field or a custom label.' };
    }
    const input = item.value;
    const supported = input === null || typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean'
      || (Array.isArray(input) && input.length <= 50 && input.every((entry) => typeof entry === 'string' && entry.length <= 100));
    if (!supported || (typeof input === 'number' && !Number.isFinite(input))) return { error: 'Attribute values must be short text, a number, a choice, or a boolean.' };
    if (typeof input === 'string' && (input.length > 1000 || MARKUP_CHARS.test(input))) return { error: 'Attribute text is too long or contains unsupported markup.' };
    normalized.push({
      ...(attributeId !== undefined ? { attribute_id: attributeId } : { custom_label: customLabel.trim() }),
      value: input,
    });
  }
  return { value: normalized };
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
export function validateListingFields(body, { isCreate, requireListingType = false }) {
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

  if (requireListingType && isCreate && input.listing_type === undefined) {
    return { error: 'Choose whether this listing is a product or a service.' };
  }
  if (input.listing_type !== undefined || (requireListingType && isCreate)) {
    if (!LISTING_TYPES.includes(input.listing_type)) return { error: 'Listing type must be product or service.' };
    payload.listing_type = input.listing_type;
  }

  if (input.pricing_model !== undefined || (requireListingType && isCreate)) {
    const model = input.pricing_model === undefined ? 'fixed' : input.pricing_model;
    if (typeof model !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(model)) return { error: 'Choose a valid pricing model.' };
    payload.pricing_model = model;
  }

  if (input.price_unit !== undefined) {
    const result = optionalText(input.price_unit, 30, 'Pricing unit');
    if (result.error) return result;
    payload.price_unit = result.value;
  }

  for (const [key, max, label, min] of [
    ['service_scope', 2000, 'Service scope', 20],
    ['service_terms', 1000, 'Service terms', 10],
  ]) {
    if (input[key] !== undefined) {
      const result = optionalText(input[key], max, label);
      if (result.error) return result;
      if (result.value && result.value.length < min) return { error: `${label} must be at least ${min} characters.` };
      payload[key] = result.value;
    }
  }

  if (input.service_scope_confirmed !== undefined) {
    if (typeof input.service_scope_confirmed !== 'boolean') return { error: 'Confirm that the service scope and terms are complete.' };
    payload.service_scope_confirmed = input.service_scope_confirmed;
  }

  if (input.product_details !== undefined) {
    const details = validateDetails(input.product_details, 'Product');
    if (details.error) return details;
    payload.product_details = details.value;
  }
  if (input.service_details !== undefined) {
    const details = validateDetails(input.service_details, 'Service');
    if (details.error) return details;
    payload.service_details = details.value;
  }
  if (input.attributes !== undefined) {
    const attributes = validateAttributeInputs(input.attributes);
    if (attributes.error) return attributes;
    payload.attributes = attributes.value;
  }

  return { payload };
}

export function validateListingDraftFields(body) {
  const input = body || {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Draft must be an object.' };
  }
  const allowed = new Set([
    'title', 'description', 'category_id', 'listing_type', 'pricing_model', 'price_usd',
    'price_max_usd', 'price_unit', 'min_order_qty', 'max_order_qty', 'stock_status',
    'stock_quantity', 'service_scope', 'service_terms', 'service_scope_confirmed',
    'product_details', 'service_details', 'attributes', 'pricing_options', 'images',
    'promo_video_url', 'blocking_reasons',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { error: 'Draft contains unsupported fields.' };
  }
  if (typeof input.title !== 'string' || !input.title.trim()) return { error: 'Enter a title.' };
  if (!LISTING_TYPES.includes(input.listing_type)) {
    return { error: 'Listing type must be product or service.' };
  }
  if (typeof input.pricing_model !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(input.pricing_model)) {
    return { error: 'Choose a valid pricing model.' };
  }

  const standardInput = { ...input };
  delete standardInput.price_usd;
  delete standardInput.price_max_usd;
  delete standardInput.min_order_qty;
  delete standardInput.max_order_qty;
  delete standardInput.stock_status;
  delete standardInput.stock_quantity;
  delete standardInput.pricing_options;
  delete standardInput.blocking_reasons;
  delete standardInput.service_scope_confirmed;
  if (standardInput.category_id === null || standardInput.category_id === '') delete standardInput.category_id;
  const standard = validateListingFields(standardInput, { isCreate: false, requireListingType: true });
  if (standard.error) return standard;

  const payload = { ...standard.payload };
  for (const key of ['price_usd', 'price_max_usd']) {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      payload[key] = null;
    } else {
      const price = parsePriceUsd(input[key]);
      if (price === null) return { error: `${key === 'price_usd' ? 'Price' : 'Maximum price'} must be a positive USD amount.` };
      payload[key] = price;
    }
  }
  if (payload.price_usd && payload.price_max_usd && payload.price_max_usd < payload.price_usd) {
    return { error: 'Maximum price must be at least the starting price.' };
  }
  for (const [key, label] of [['min_order_qty', 'Minimum order quantity'], ['max_order_qty', 'Maximum order quantity'], ['stock_quantity', 'Stock quantity']]) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      payload[key] = null;
      continue;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    const minimum = key === 'stock_quantity' ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum || value > 100000000) {
      return { error: `${label} must be a whole number between ${minimum} and 100000000.` };
    }
    payload[key] = value;
  }
  if (payload.min_order_qty && payload.max_order_qty && payload.max_order_qty < payload.min_order_qty) {
    return { error: 'Maximum order quantity must be at least the minimum.' };
  }
  if (input.stock_status === undefined || input.stock_status === null || input.stock_status === '') {
    payload.stock_status = null;
  } else if (!DRAFT_STOCK_STATUSES.includes(input.stock_status)) {
    return { error: 'Choose a valid stock status.' };
  } else {
    payload.stock_status = input.stock_status;
  }
  if (input.service_scope_confirmed !== undefined && typeof input.service_scope_confirmed !== 'boolean') {
    return { error: 'Service scope confirmation must be true or false.' };
  }
  payload.service_scope_confirmed = input.service_scope_confirmed === true;

  const pricingOptions = input.pricing_options ?? [];
  if (!Array.isArray(pricingOptions) || pricingOptions.length > 20) {
    return { error: 'Add no more than 20 pricing options.' };
  }
  payload.pricing_options = [];
  for (const option of pricingOptions) {
    if (!option || typeof option !== 'object' || Array.isArray(option)
      || Object.keys(option).some((key) => !['label', 'price_usd', 'price_unit'].includes(key))) {
      return { error: 'Each pricing option must have a label, optional price, and optional unit.' };
    }
    const label = typeof option.label === 'string' ? option.label.trim() : '';
    if (!label || label.length > 80 || MARKUP_CHARS.test(label)) {
      return { error: 'Pricing option labels must be 1 to 80 characters and contain no markup.' };
    }
    const price = option.price_usd === undefined || option.price_usd === null || option.price_usd === ''
      ? null : parsePriceUsd(option.price_usd);
    if (option.price_usd !== undefined && option.price_usd !== null && option.price_usd !== '' && price === null) {
      return { error: 'Pricing option prices must be positive USD amounts.' };
    }
    const unit = option.price_unit === undefined || option.price_unit === null || option.price_unit === ''
      ? null : optionalText(option.price_unit, 30, 'Pricing option unit');
    if (unit?.error) return unit;
    payload.pricing_options.push({ label, price_usd: price, price_unit: unit?.value ?? null });
  }

  return { payload };
}
