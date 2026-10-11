// Creator subscriptions bought with Google Play (Android app).
//
// Google Play subscriptions are fixed products, so creators' monthly prices
// map to subscription TIERS, each available as a few products ("slots"):
// Google lets a user hold only one live subscription per product, so a second
// creator at the same price is bought on the next free slot. Every purchase is
// bound to the subscriber (obfuscatedExternalAccountId) and the creator
// (obfuscatedExternalProfileId = creator's participant id) inside Google's own
// record; the server reads both from Google, never from the client.
//
// The purchase is acknowledged only after the subscription is recorded. If it
// can't be (already subscribed, creator plan off, price too low), it's left
// unacknowledged and Google refunds it automatically after 3 days.
//
// Renewals, cancellations and expiry follow Google's state: the app refreshes
// on Library open, and the daily billing sync refreshes subscriptions whose
// period has ended. Each renewal order becomes one paid month in the creator's
// ledger. Refunds come from Google's voided-purchases list.
//
// Uses the Google Play credentials of the AI subscription (lib/aiPayments.js,
// exported helpers only - nothing in that flow changes). The AI flow's own
// Pub/Sub handler ignores these products (they are not AI plans).

import { GOOGLE_PLAY_PACKAGE_NAME, getGooglePlayAccessToken } from './aiPayments';

async function playRequest(path, method = 'GET', body) {
  const accessToken = await getGooglePlayAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `google_play_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const enc = encodeURIComponent;
export const getCreatorSubscriptionPurchase = (token) => playRequest(`/purchases/subscriptionsv2/tokens/${enc(token)}`);
export const acknowledgeCreatorSubscription = (productId, token) => playRequest(`/purchases/subscriptions/${enc(productId)}/tokens/${enc(token)}:acknowledge`, 'POST', {});
/** Stops auto-renew (access continues to the end of the paid month). */
export const cancelCreatorSubscription = (productId, token) => playRequest(`/purchases/subscriptions/${enc(productId)}/tokens/${enc(token)}:cancel`, 'POST');

/** Voided subscription purchases (refunds / chargebacks) since startTimeMs. */
export async function listVoidedSubscriptionPurchases(startTimeMs) {
  const voided = [];
  let token = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ type: '1', maxResults: '1000', startTime: String(startTimeMs) });
    if (token) query.set('token', token);
    const data = await playRequest(`/purchases/voidedpurchases?${query}`);
    voided.push(...(data.voidedPurchases || []).filter((v) => !v.kind || String(v.kind).includes('voidedPurchase')));
    token = data.tokenPagination?.nextPageToken || '';
    if (!token) break;
  }
  return voided;
}

/** Admin diagnostics: does a subscription product exist / is a base plan active? */
export async function getPlaySubscriptionStatus(productId) {
  try {
    const sub = await playRequest(`/subscriptions/${enc(productId)}`);
    const plans = sub.basePlans || [];
    const monthly = plans.filter((p) => String(p.state || '').toUpperCase() === 'ACTIVE' && p.autoRenewingBasePlanType?.billingPeriodDuration === 'P1M');
    const usd = monthly.flatMap((p) => p.regionalConfigs || []).find((c) => c.price?.currencyCode === 'USD')?.price;
    return {
      state: monthly.length === 1 ? 'active' : monthly.length > 1 ? 'ambiguous' : 'inactive',
      price: usd ? { amount: Number(usd.units || 0) + Number(usd.nanos || 0) / 1e9, currency: 'USD' } : null,
      detail: monthly.length > 1 ? 'More than one active monthly base plan' : monthly.length ? 'monthly base plan' : 'No active monthly base plan',
    };
  } catch (error) {
    if (error.status === 404) return { state: 'not_found', price: null, detail: 'Not created in Play Console yet' };
    return { state: 'check_failed', price: null, detail: error.message };
  }
}

const LIVE_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);

/** The parts of a subscriptionsv2 response the rules need. */
export function parseCreatorSubscription(payload, now = Date.now()) {
  const item = (payload?.lineItems || [])[0] || {};
  const expiry = item.expiryTime || null;
  const state = payload?.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED';
  return {
    productId: item.productId || null,
    state,
    expiryTime: expiry,
    startTime: payload?.startTime || null,
    autoRenew: item.autoRenewingPlan ? item.autoRenewingPlan.autoRenewEnabled !== false : false,
    orderId: item.latestSuccessfulOrderId || payload?.latestOrderId || null,
    accountId: payload?.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
    profileId: payload?.externalAccountIdentifiers?.obfuscatedExternalProfileId || null,
    linkedToken: payload?.linkedPurchaseToken || null,
    acknowledged: payload?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    active: LIVE_STATES.has(state) && !!expiry && new Date(expiry).getTime() > now,
    pending: state === 'SUBSCRIPTION_STATE_PENDING',
    onHold: ['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED'].includes(state),
    multipleItems: (payload?.lineItems || []).length > 1,
  };
}

export const SUBSCRIBE_ERRORS = {
  token_already_used: [409, 'This purchase has already been used'],
  plan_not_available: [409, 'This creator does not offer a subscription right now. Google Play will refund you automatically.'],
  own_product: [409, 'You cannot subscribe to yourself. Google Play will refund you automatically.'],
  already_subscribed: [409, 'You are already subscribed to this creator. Google Play will refund this purchase automatically.'],
  underpaid: [409, "This subscription price doesn't cover the creator's plan. Google Play will refund you automatically."],
  buyer_not_found: [404, 'Account not found'],
};

/**
 * Brings a stored Google subscription in line with Google's record: status,
 * auto-renew, and a paid month for every new renewal order.
 */
export async function syncGoogleSubscription(row, google, deps) {
  if (row.status === 'revoked') return { subscription_id: row.id, status: 'revoked', current_period_end: row.current_period_end };
  const rowEnd = new Date(row.current_period_end).getTime();
  if (google.active && google.orderId && google.expiryTime && new Date(google.expiryTime).getTime() > rowEnd) {
    await deps.recordPayment({
      subscriptionId: row.id, providerRef: google.orderId, providerTxnId: null,
      periodStart: row.current_period_end, periodEnd: google.expiryTime, grossUsd: Number(row.price_usd),
    });
  }
  const status = google.active ? 'active' : google.onHold || google.pending ? 'past_due' : 'expired';
  const update = { status, auto_renew: google.active && google.autoRenew };
  if (status === 'expired' && row.status !== 'expired') Object.assign(update, { ended_at: new Date(deps.now()).toISOString(), end_reason: google.autoRenew ? 'payment not completed' : 'cancelled' });
  await deps.updateSubscription(row.id, update);
  return {
    subscription_id: row.id,
    status,
    auto_renew: update.auto_renew,
    current_period_end: google.active && google.expiryTime && new Date(google.expiryTime).getTime() > rowEnd ? google.expiryTime : row.current_period_end,
  };
}

export async function processGoogleCreatorSubscription({ participantId, productId, purchaseToken, creatorUsername }, deps) {
  if (!productId || !purchaseToken || purchaseToken.length > 4096) return { status: 400, body: { error: 'A Google Play subscription purchase is required' } };
  const slot = await deps.findSlotProduct(productId);
  if (!slot) return { status: 400, body: { error: 'Unknown subscription product' } };

  const google = parseCreatorSubscription(await deps.getPurchase(purchaseToken), deps.now());
  if (google.productId !== productId || google.multipleItems) return { status: 400, body: { error: 'Google Play product mismatch' } };
  if (!google.accountId) return { status: 400, body: { error: 'This purchase is not linked to a One Dream account' } };
  if (google.accountId !== participantId) return { status: 409, body: { error: 'This purchase belongs to another account' } };

  const existing = await deps.findSubscriptionByToken(purchaseToken);
  if (existing) {
    if (existing.subscriber_id !== participantId) return { status: 409, body: { error: 'This purchase belongs to another account' } };
    const synced = await syncGoogleSubscription(existing, google, deps);
    if (google.active && !google.acknowledged) await deps.acknowledge(productId, purchaseToken).catch(() => {});
    return { status: 200, body: { success: true, already_recorded: true, creator_username: existing.creator_username, ...synced } };
  }

  if (deps.paused()) return { status: 503, body: { error: 'Digital purchases are paused right now' } };
  if (google.pending) return { status: 202, body: { success: false, pending: true, error: 'Payment is pending at Google Play' } };
  if (!google.active) return { status: 400, body: { error: 'This subscription is not active' } };
  if (!google.profileId) return { status: 400, body: { error: 'This purchase is not linked to a creator' } };

  const plan = await deps.findPlanByCreatorId(google.profileId);
  if (!plan) return { status: 409, body: { error: SUBSCRIBE_ERRORS.plan_not_available[1], code: 'plan_not_available' } };
  if (creatorUsername && creatorUsername !== plan.creator_username) return { status: 409, body: { error: 'This purchase was made for a different creator' } };

  let subscriptionId;
  try {
    subscriptionId = await deps.startSubscription({
      subscriberId: participantId, creatorUsername: plan.creator_username, providerRef: purchaseToken, productId,
      paidTierId: slot.tier_id, periodStart: google.startTime || new Date(deps.now()).toISOString(), periodEnd: google.expiryTime,
      autoRenew: google.autoRenew, replacesRef: google.linkedToken,
    });
  } catch (error) {
    const key = Object.keys(SUBSCRIBE_ERRORS).find((code) => String(error?.message || '').includes(code));
    if (!key) throw error;
    const [status, message] = SUBSCRIBE_ERRORS[key];
    return { status, body: { error: message, code: key } };
  }
  if (google.orderId) {
    await deps.recordPayment({
      subscriptionId, providerRef: google.orderId, providerTxnId: null,
      periodStart: google.startTime || new Date(deps.now()).toISOString(), periodEnd: google.expiryTime, grossUsd: Number(slot.price_usd),
    });
  }
  if (!google.acknowledged) await deps.acknowledge(productId, purchaseToken);
  return { status: 200, body: { success: true, subscription_id: subscriptionId, creator_username: plan.creator_username, current_period_end: google.expiryTime, status: 'active' } };
}
