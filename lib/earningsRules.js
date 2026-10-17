// Rules for partner & creator earnings that need no database: money units,
// the Google Play earnings-report parser, signed affiliate attribution tokens,
// offer validation and the reseller margin split. Only Node's built-in crypto,
// so it runs under `node --test` (scripts/test-earnings.mjs).
//
// Money is held as integer USD millionths ("micro") everywhere in the ledger.

import crypto from 'crypto';

export const MICRO = 1000000;
export const toMicro = (usd) => Math.round(Number(usd || 0) * MICRO);
export const fromMicro = (micro) => Number(micro || 0) / MICRO;
/** Display: $1.23, or $0.0053 for sub-cent amounts. */
export function formatMicro(micro) {
  const usd = fromMicro(micro);
  const abs = Math.abs(usd);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${usd < 0 ? '-' : ''}$${abs.toFixed(digits)}`;
}

export const EARNING_SOURCES = ['gift_recipient', 'gift_referral', 'affiliate', 'resale', 'referral'];
export const SOURCE_LABELS = {
  gift_recipient: 'Gifts received',
  gift_referral: 'Gift referrals (10%)',
  affiliate: 'Affiliate commission',
  resale: 'Reseller margin',
  referral: 'Seller & buyer referrals',
};

// ---------------------------------------------------------------------------
// Google Play earnings report (Play Console > Download reports > Financial >
// Earnings). One row per transaction component: Charge, Google fee, Tax,
// Charge refund, Google fee refund, Tax refund. The order id is in the
// "Description" column (GPA.xxxx-xxxx-xxxx-xxxxx).
// ---------------------------------------------------------------------------

/** RFC 4180 CSV -> array of string arrays (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

const COLUMN_ALIASES = {
  order_id: ['description', 'order number', 'order id'],
  transaction_date: ['transaction date'],
  transaction_type: ['transaction type'],
  product_id: ['product id', 'sku id'],
  buyer_country: ['buyer country'],
  merchant_currency: ['merchant currency'],
  amount: ['amount (merchant currency)', 'amount merchant currency'],
};

/**
 * Parses an earnings report. Returns { rows, errors, merchantCurrency }.
 * Each row: { line_hash, order_id, product_id, transaction_type, amount_micro,
 * buyer_country, transaction_date, raw }. Amounts must be in USD (the ledger
 * currency); a report in another payout currency is refused rather than
 * converted with a guessed rate.
 */
export function parsePlayEarningsReport(csvText) {
  const table = parseCsv(csvText);
  if (table.length < 2) return { rows: [], errors: ['The report is empty'], merchantCurrency: null };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(COLUMN_ALIASES)) {
    col[key] = header.findIndex((h) => names.includes(h));
  }
  const missing = ['order_id', 'transaction_type', 'amount', 'merchant_currency'].filter((k) => col[k] < 0);
  if (missing.length) return { rows: [], errors: [`Missing column(s): ${missing.join(', ')}`], merchantCurrency: null };

  const rows = [];
  const errors = [];
  const seen = new Map();
  let merchantCurrency = null;
  table.slice(1).forEach((cells, index) => {
    const get = (key) => (col[key] >= 0 ? String(cells[col[key]] ?? '').trim() : '');
    const currency = get('merchant_currency').toUpperCase();
    merchantCurrency = merchantCurrency || currency;
    if (currency !== 'USD') { errors.push(`Row ${index + 2}: merchant currency ${currency || '?'} (only USD reports can be imported)`); return; }
    const amount = Number(get('amount').replace(/,/g, ''));
    if (!Number.isFinite(amount)) { errors.push(`Row ${index + 2}: invalid amount`); return; }
    const orderId = get('order_id');
    if (!orderId) { errors.push(`Row ${index + 2}: no order id`); return; }
    const rawLine = cells.join('\u001f');
    const occurrence = (seen.get(rawLine) || 0) + 1;
    seen.set(rawLine, occurrence);
    const isoDate = toIsoDate(get('transaction_date'));
    rows.push({
      line_hash: crypto.createHash('sha256').update(`${rawLine}#${occurrence}`).digest('hex'),
      order_id: orderId,
      product_id: get('product_id') || null,
      transaction_type: get('transaction_type'),
      amount_micro: Math.round(amount * MICRO),
      buyer_country: get('buyer_country') || null,
      transaction_date: isoDate,
      raw: Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])),
    });
  });
  return { rows, errors, merchantCurrency };
}

function toIsoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Keeps only the rows for Dream Coin products (other products share the report). */
export function coinRowsOnly(rows, productIds) {
  const wanted = new Set(productIds);
  return rows.filter((row) => !row.product_id || wanted.has(row.product_id));
}

// ---------------------------------------------------------------------------
// Signed attribution tokens. The server records the click; the token only
// proves which click a device holds, so it can't be forged or edited.
// ---------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signAttributionToken({ clickId, itemId, issuedAt = Date.now() }, secret) {
  if (!secret) throw new Error('attribution_secret_missing');
  const body = b64url(JSON.stringify({ c: clickId, i: itemId, t: issuedAt }));
  const mac = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

/** Returns { clickId, itemId, issuedAt } or null (bad signature, malformed or older than maxAgeMs). */
export function verifyAttributionToken(token, secret, maxAgeMs, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 400) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const given = fromB64url(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(fromB64url(body).toString('utf8'));
    if (!/^[0-9a-f-]{36}$/i.test(data.c) || !/^[0-9a-f-]{36}$/i.test(data.i) || !Number.isFinite(data.t)) return null;
    if (maxAgeMs && now - data.t > maxAgeMs) return null;
    return { clickId: data.c, itemId: data.i, issuedAt: data.t };
  } catch {
    return null;
  }
}

export const emailHash = (email) => crypto.createHash('md5').update(String(email || '').trim().toLowerCase()).digest('hex');
export const visitorHash = (visitor, salt) => crypto.createHash('sha256').update(`${salt || ''}:${visitor || ''}`).digest('hex').slice(0, 40);
export const newLinkCode = () => crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).padEnd(8, 'x');

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/**
 * Validates a seller's offer settings against the platform limits.
 * Returns { ok, value } or { ok: false, error }.
 */
export function validateOffer(input, { maxCommissionPercent, itemPriceUsd }) {
  const errors = [];
  const value = {
    allow_referral: input.allow_referral !== false,
    allow_storefront: input.allow_storefront !== false,
    allow_resale: input.allow_resale === true,
    funding: input.funding === 'platform' ? 'platform' : 'seller',
    commission_percent: Number(input.commission_percent ?? 10),
    resale_floor_usd: input.resale_floor_usd === undefined || input.resale_floor_usd === null || input.resale_floor_usd === '' ? null : Number(input.resale_floor_usd),
    resale_ceiling_usd: input.resale_ceiling_usd === undefined || input.resale_ceiling_usd === null || input.resale_ceiling_usd === '' ? null : Number(input.resale_ceiling_usd),
    fulfilment: input.fulfilment === 'reseller' ? 'reseller' : 'seller',
    reseller_responsibilities: input.reseller_responsibilities && typeof input.reseller_responsibilities === 'object' ? input.reseller_responsibilities : {},
    approval: input.approval === 'manual' ? 'manual' : 'auto',
    status: ['active', 'paused', 'ended'].includes(input.status) ? input.status : 'active',
  };
  if (!value.allow_referral && !value.allow_storefront && !value.allow_resale) errors.push('Allow at least one way to earn');
  if (!(value.commission_percent >= 0) || value.commission_percent > maxCommissionPercent) {
    errors.push(`Commission must be between 0% and ${maxCommissionPercent}%`);
  }
  if (value.allow_resale) {
    if (!(value.resale_floor_usd > 0)) errors.push('Set the lowest price you accept for resale');
    if (value.resale_ceiling_usd !== null && !(value.resale_ceiling_usd >= value.resale_floor_usd)) errors.push('The resale ceiling must be at least the floor');
    if (itemPriceUsd && value.resale_floor_usd > itemPriceUsd * 10) errors.push('The resale floor looks wrong for this listing');
  }
  if (value.fulfilment === 'reseller') {
    for (const key of ['delivery', 'returns', 'disputes']) {
      if (!String(value.reseller_responsibilities[key] || '').trim()) errors.push(`Say who handles ${key} when a reseller fulfils`);
    }
  }
  return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true, value };
}

/** What a seller-funded offer means for the seller, shown before they accept it. */
export function sellerFundedImpact(priceUsd, commissionPercent, platformPercent) {
  const gross = toMicro(priceUsd);
  const platform = Math.round(gross * platformPercent / 100);
  const commission = Math.min(Math.floor(gross * commissionPercent / 100), Math.max(0, gross - platform));
  return { gross_micro: gross, platform_micro: platform, commission_micro: commission, seller_receives_micro: gross - platform - commission };
}

/**
 * Reseller split for one order line (P3): the seller receives the floor less
 * the platform commission on it; the reseller the margin less the platform
 * commission on the margin. All in micro, exact.
 */
export function resaleSplit({ resalePriceUsd, floorUsd, quantity = 1, platformPercent }) {
  const price = toMicro(resalePriceUsd) * quantity;
  const floor = toMicro(floorUsd) * quantity;
  if (price < floor) throw new Error('resale_price_below_floor');
  // Marketplace amounts are whole cents, so each fee is rounded to a cent.
  const cent = (micro) => Math.round(micro / 10000) * 10000;
  const sellerFee = cent(floor * platformPercent / 100);
  const marginFee = cent((price - floor) * platformPercent / 100);
  return {
    buyer_pays_micro: price,
    seller_receives_micro: floor - sellerFee,
    reseller_receives_micro: price - floor - marginFee,
    platform_micro: sellerFee + marginFee,
    seller_fee_micro: sellerFee,
    margin_fee_micro: marginFee,
  };
}

/** The gift split, as the database applies it (recipient and merchant rounded down). */
export function giftSplit(valueMicro, recipientPercent, merchantPercent) {
  const recipient = Math.floor(valueMicro * recipientPercent / 100);
  const merchant = Math.floor(valueMicro * merchantPercent / 100);
  return { recipient_micro: recipient, merchant_micro: merchant, platform_micro: valueMicro - recipient - merchant };
}

export const PAYOUT_ERRORS = {
  payouts_disabled: [503, 'Withdrawals are not open yet'],
  below_minimum: [400, 'This is below the minimum withdrawal'],
  payee_profile_required: [400, 'Add your payout details first'],
  payee_not_verified: [403, 'Your payout details are waiting for verification'],
  payee_under_18: [403, 'You must be 18 or older to withdraw earnings'],
  insufficient_available_balance: [400, 'That is more than your available balance'],
};
export function payoutErrorReply(message) {
  const key = Object.keys(PAYOUT_ERRORS).find((k) => String(message || '').includes(k));
  if (!key) return null;
  const [status, error] = PAYOUT_ERRORS[key];
  return { status, body: { error, code: key } };
}

export const AFFILIATE_ERRORS = {
  partner_inactive: [403, 'Your partner account is not active'],
  offer_unavailable: [400, 'This offer is not available'],
  offer_not_accepted_by_seller: [400, 'The seller has not confirmed this offer yet'],
  own_listing: [400, 'You cannot promote your own listing'],
  model_not_allowed: [400, 'The seller does not allow this way of earning on this listing'],
  resale_price_out_of_range: [400, 'Choose a price within the range the seller allows'],
  membership_closed: [400, 'The seller has closed your partnership for this listing'],
  price_change_limit: [429, 'You can change a resale price once a day'],
  membership_not_found: [404, 'Partnership not found'],
  link_not_found: [404, 'This link is not valid'],
  membership_inactive: [400, 'This partnership is not active'],
  no_valid_clicks: [400, 'No valid affiliate clicks'],
};
export function affiliateErrorReply(message) {
  const key = Object.keys(AFFILIATE_ERRORS).find((k) => String(message || '').includes(k));
  if (!key) return null;
  const [status, error] = AFFILIATE_ERRORS[key];
  return { status, body: { error, code: key } };
}
