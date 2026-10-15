// Google Play Billing for advertising packages and listing boosts.
//
// These are ONE-TIME (consumable) in-app products, not subscriptions, so they
// use Google's purchases.products API. Credentials and the package name are
// shared with the AI subscription (lib/aiPayments.js); nothing in that flow
// changes.
//
// Billing is live per package: a package can be bought once it is active and
// has a google_play_product_id that exists in Play Console. The app only
// enables "Buy" for products Google Play actually returns, and the server
// only grants after Google confirms a real purchase - a placeholder id with
// no Play product can never produce a valid purchase.
// Emergency stop (default off): PROMOTIONAL_BILLING_PAUSED=true.

import { GOOGLE_PLAY_PACKAGE_NAME, getGooglePlayAccessToken } from './aiPayments';

export function promotionalBillingPaused() {
  return process.env.PROMOTIONAL_BILLING_PAUSED === 'true';
}

export function packagePurchasable(pkg) {
  return !promotionalBillingPaused() && !!pkg?.is_active && !!String(pkg?.google_play_product_id || '').trim();
}

const base = () => `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}`;

async function googleRequest(path, method = 'GET') {
  const accessToken = await getGooglePlayAccessToken();
  const response = await fetch(`${base()}${path}`, { method, headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `google_play_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * purchases.products.get - purchaseState 0 purchased, 1 cancelled, 2 pending;
 * consumptionState 0 not consumed, 1 consumed; acknowledgementState 0/1.
 */
export function getProductPurchase(productId, purchaseToken) {
  return googleRequest(`/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`);
}

/** Consuming also acknowledges, and lets the buyer purchase the package again. */
export async function consumeProductPurchase(productId, purchaseToken) {
  const path = `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  try {
    await googleRequest(`${path}:consume`, 'POST');
    return 'consumed';
  } catch (error) {
    // Unacknowledged purchases are refunded by Google after 3 days - make
    // sure it is at least acknowledged.
    await googleRequest(`${path}:acknowledge`, 'POST').catch(() => {});
    return 'acknowledged';
  }
}

/** Refunded / charged-back / revoked one-time purchases since startTimeMs. */
export async function listVoidedProductPurchases(startTimeMs) {
  const voided = [];
  let token = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ type: '0', maxResults: '1000', startTime: String(startTimeMs) });
    if (token) query.set('token', token);
    const data = await googleRequest(`/purchases/voidedpurchases?${query}`);
    voided.push(...(data.voidedPurchases || []));
    token = data.tokenPagination?.nextPageToken || '';
    if (!token) break;
  }
  return voided;
}

/** Checks a Google product purchase response against our rules. */
export function evaluateProductPurchase(purchase, participantId) {
  const state = Number(purchase?.purchaseState);
  if (state === 2) return { ok: false, pending: true, reason: 'Payment is pending at Google Play' };
  if (state !== 0) return { ok: false, reason: 'This purchase was cancelled' };
  if (!purchase.obfuscatedExternalAccountId) {
    // The app always binds purchases to the account; an unbound one did not come from it.
    return { ok: false, reason: 'This purchase is not linked to a One Dream account' };
  }
  if (purchase.obfuscatedExternalAccountId !== participantId) {
    return { ok: false, conflict: true, reason: 'This purchase belongs to another account' };
  }
  if (purchase.quantity && Number(purchase.quantity) !== 1) return { ok: false, reason: 'Multi-quantity purchases are not supported' };
  return { ok: true };
}

const priceFromMicros = (money) => money && money.priceMicros
  ? { amount: Number(money.priceMicros) / 1e6, currency: money.currency }
  : money && (money.units !== undefined || money.nanos !== undefined)
    ? { amount: Number(money.units || 0) + Number(money.nanos || 0) / 1e9, currency: money.currencyCode }
    : null;

/**
 * Admin diagnostics: does this product exist in Play Console, is it active,
 * and what is its US price? Uses the one-time products API (the legacy
 * in-app products API answers "Please migrate to the new publishing API").
 * Returns { state, price, detail }: active | inactive | not_found | check_failed
 */
export async function getPlayProductStatus(productId) {
  try {
    // The single-product GET returns 404 even for existing products; batchGet works.
    const { oneTimeProducts = [] } = await googleRequest(`/oneTimeProducts:batchGet?productIds=${encodeURIComponent(productId)}`);
    const product = oneTimeProducts[0] || {};
    const options = product.purchaseOptions || [];
    const active = options.some((option) => String(option.state || '').toUpperCase() === 'ACTIVE');
    const configs = options.flatMap((option) => option.regionalPricingAndAvailabilityConfigs || []);
    const config = configs.find((c) => c.regionCode === 'US') || configs.find((c) => c.price?.currencyCode === 'USD') || configs[0];
    return { state: active ? 'active' : 'inactive', price: priceFromMicros(config?.price), detail: 'one-time product' };
  } catch (error) {
    if (error.status === 404) return { state: 'not_found', price: null, detail: 'Not created in Play Console yet' };
    return { state: 'check_failed', price: null, detail: error.message };
  }
}
