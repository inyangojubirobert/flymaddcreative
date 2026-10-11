// Database + provider wiring for digital-product billing (website Paystack
// checkouts, creator subscriptions on both platforms). The rules live in
// lib/digitalPaystack.js and lib/digitalSubscriptions.js.

import { digitalDb, digitalSalesPaused } from './digital';
import { getUsdToNgnRate } from './currency';
import { GOOGLE_PLAY_PACKAGE_NAME } from './aiPayments';
import { paystackRequest } from './digitalPaystack';
import {
  acknowledgeCreatorSubscription,
  getCreatorSubscriptionPurchase,
  parseCreatorSubscription,
  syncGoogleSubscription,
} from './digitalSubscriptions';

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

const rpc = async (name, args) => {
  const { data, error } = await digitalDb.rpc(name, args);
  if (error) {
    // Unique index on live subscriptions: a concurrent second subscription.
    if (error.code === '23505' && String(error.message).includes('digital_subscriptions_one_live')) throw new Error('already_subscribed');
    throw new Error(error.message);
  }
  return data;
};

export const fallbackEmail = 'support@flymaddcreative.online';

const startSubscription = ({ subscriberId, creatorUsername, providerRef, productId = null, paidTierId, periodStart, periodEnd, autoRenew, authorizationCode = null, email = null, replacesRef = null }, provider) =>
  rpc('digital_start_subscription', {
    p_subscriber_id: subscriberId, p_creator_username: creatorUsername, p_provider: provider, p_provider_ref: providerRef,
    p_product_id: productId, p_paid_tier_id: paidTierId, p_period_start: periodStart, p_period_end: periodEnd,
    p_auto_renew: !!autoRenew, p_authorization_code: authorizationCode, p_email: email, p_replaces_ref: replacesRef,
  });

const recordSubscriptionPayment = ({ subscriptionId, providerRef, providerTxnId = null, periodStart, periodEnd, grossUsd, feeUsd = null }, provider) =>
  rpc('digital_record_subscription_payment', {
    p_subscription_id: subscriptionId, p_provider: provider, p_provider_ref: providerRef, p_provider_txn_id: providerTxnId,
    p_period_start: periodStart, p_period_end: periodEnd, p_gross_usd: grossUsd, p_fee_usd: feeUsd,
  });

const updateSubscription = async (id, fields) =>
  must(await digitalDb.from('digital_subscriptions').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id));

export const paystackDeps = {
  paused: digitalSalesPaused,
  now: () => Date.now(),
  fallbackEmail,
  rate: getUsdToNgnRate,
  async loadProduct(itemId) {
    const product = must(await digitalDb.from('digital_products').select('*, digital_price_tiers(*)').eq('item_id', itemId).maybeSingle());
    return product ? { product, tier: product.digital_price_tiers } : null;
  },
  async ownsItem(buyerId, itemId) {
    const row = must(await digitalDb.from('digital_licenses').select('id').eq('buyer_id', buyerId).eq('item_id', itemId).eq('status', 'active').maybeSingle());
    return !!row;
  },
  async loadPlan(creatorUsername) {
    const plan = must(await digitalDb.from('digital_creator_plans').select('*, digital_sub_tiers(*)').eq('creator_username', String(creatorUsername || '')).maybeSingle());
    return plan ? { plan, tier: plan.digital_sub_tiers } : null;
  },
  async liveSubscription(subscriberId, creatorUsername) {
    const row = must(await digitalDb.from('digital_subscriptions').select('id').eq('subscriber_id', subscriberId).eq('creator_username', creatorUsername)
      .in('status', ['active', 'past_due']).gt('current_period_end', new Date().toISOString()).maybeSingle());
    return !!row;
  },
  async planActive(creatorUsername) {
    const plan = must(await digitalDb.from('digital_creator_plans').select('is_active').eq('creator_username', creatorUsername).maybeSingle());
    return !!plan?.is_active;
  },
  async insertPayment(row) { must(await digitalDb.from('digital_paystack_payments').insert(row)); },
  initialize: (body) => paystackRequest('/transaction/initialize', { method: 'POST', body }),
  async loadPayment(reference) {
    return must(await digitalDb.from('digital_paystack_payments').select('*').eq('reference', reference).maybeSingle());
  },
  fetchTransaction: (reference) => paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`),
  /** Conditional update (expectStatus): returns the row only if it was in that status. */
  async updatePayment(reference, fields, expectStatus) {
    let query = digitalDb.from('digital_paystack_payments').update(fields).eq('reference', reference);
    if (expectStatus) query = query.eq('status', expectStatus);
    return must(await query.select('reference').maybeSingle());
  },
  refund: (reference) => paystackRequest('/refund', { method: 'POST', body: { transaction: reference, merchant_note: 'One Dream digital purchase could not be delivered' } }),
  grantLicense: ({ buyerId, itemId, paidTierId, providerRef, orderId, feeUsd }) => rpc('digital_grant_license', {
    p_buyer_id: buyerId, p_item_id: itemId, p_paid_tier_id: paidTierId, p_provider: 'paystack',
    p_provider_ref: providerRef, p_order_id: orderId, p_is_paid: true, p_fee_usd: feeUsd,
  }),
  startSubscription: (input) => startSubscription(input, 'paystack'),
  recordSubscriptionPayment: (input) => recordSubscriptionPayment(input, 'paystack'),
  updateSubscription,
  async countPayments(subscriptionId) {
    const { count, error } = await digitalDb.from('digital_subscription_payments').select('id', { count: 'exact', head: true }).eq('subscription_id', subscriptionId);
    if (error) throw new Error(error.message);
    return count || 0;
  },
  chargeAuthorization: (body) => paystackRequest('/transaction/charge_authorization', { method: 'POST', body }),
};

export const googleSubscriptionDeps = {
  paused: digitalSalesPaused,
  now: () => Date.now(),
  async findSlotProduct(productId) {
    const row = must(await digitalDb.from('digital_sub_products').select('id, tier_id, digital_sub_tiers(price_usd)').eq('google_play_product_id', productId).maybeSingle());
    return row ? { id: row.id, tier_id: row.tier_id, price_usd: Number(row.digital_sub_tiers?.price_usd) } : null;
  },
  getPurchase: getCreatorSubscriptionPurchase,
  async findSubscriptionByToken(token) {
    return must(await digitalDb.from('digital_subscriptions').select('*').eq('provider', 'google_play').eq('provider_ref', token).maybeSingle());
  },
  async findPlanByCreatorId(creatorId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(creatorId))) return null;
    return must(await digitalDb.from('digital_creator_plans').select('*').eq('creator_id', creatorId).eq('is_active', true).maybeSingle());
  },
  startSubscription: (input) => startSubscription(input, 'google_play'),
  recordPayment: (input) => recordSubscriptionPayment(input, 'google_play'),
  updateSubscription,
  acknowledge: acknowledgeCreatorSubscription,
};

/** Re-reads one stored Google subscription from Google and applies it. */
export async function refreshGoogleSubscriptionRow(row) {
  const google = parseCreatorSubscription(await getCreatorSubscriptionPurchase(row.provider_ref));
  return syncGoogleSubscription(row, google, googleSubscriptionDeps);
}

/** Google may have renewed (or ended) a subscription whose period is over. */
export const googleRefreshDue = (row) => row.provider === 'google_play' && ['active', 'past_due'].includes(row.status)
  && new Date(row.current_period_end).getTime() < Date.now() + 5 * 60 * 1000;

// The user's creator subscriptions (Library + subscriptions route).
export const manageUrl = (productId) => `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(productId || '')}&package=${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}`;
const SELECT = 'id, creator_username, provider, product_id, price_usd, status, auto_renew, current_period_start, current_period_end, provider_ref, paystack_authorization_code, last_renewal_error, end_reason, created_at';

export async function listSubscriptions(subscriberId) {
  const load = () => digitalDb.from('digital_subscriptions').select(SELECT).eq('subscriber_id', subscriberId).order('created_at', { ascending: false }).limit(100);
  let { data, error } = await load();
  if (error) throw error;
  const due = (data || []).filter(googleRefreshDue).slice(0, 5);
  if (due.length) {
    await Promise.all(due.map((row) => refreshGoogleSubscriptionRow(row).catch((e) => console.error('subscription refresh failed', row.id, e.message))));
    ({ data, error } = await load());
    if (error) throw error;
  }
  const now = Date.now();
  return (data || []).map((s) => {
    const live = ['active', 'past_due'].includes(s.status) && new Date(s.current_period_end).getTime() > now;
    return {
      id: s.id,
      creator_username: s.creator_username,
      provider: s.provider,
      price_usd: Number(s.price_usd),
      status: s.status,
      has_access: live,
      auto_renew: s.auto_renew,
      current_period_end: s.current_period_end,
      can_cancel: s.provider === 'paystack' && live && s.auto_renew,
      can_resume: s.provider === 'paystack' && live && !s.auto_renew && !!s.paystack_authorization_code,
      renewal_problem: s.status === 'past_due' ? (s.last_renewal_error || 'Renewal payment did not go through') : null,
      end_reason: s.end_reason,
      manage_url: s.provider === 'google_play' ? manageUrl(s.product_id) : null,
      product_id: s.provider === 'google_play' ? s.product_id : null,
    };
  });
}
