// Website (Paystack) purchases and creator subscriptions for digital products.
//
// Separate from the marketplace checkout (pages/api/catalogue/*), AI
// subscriptions, votes and the wallet: own reference prefix (dgp_ / dgr_),
// own table (digital_paystack_payments), own ledger rows (digital_earnings).
// No webhook is needed (Paystack allows one webhook URL per account and it is
// already used): payments are confirmed by
//   1. the buyer's return from checkout (POST /api/digital/paystack-verify),
//   2. the daily billing sync, which re-checks unconfirmed checkouts.
// Both call verifyDigitalCheckout(), which is idempotent.
//
// Binding: the server creates the checkout for the logged-in buyer and the
// exact item (or creator) at the server's price; the reference is stored with
// both, and Paystack's verified amount must cover it. If the content can't be
// delivered (already owned, unpublished...), the payment is refunded at once.
//
// Rules are separated from I/O (deps injected) so they can be tested.

import crypto from 'crypto';

const PAYSTACK_API = 'https://api.paystack.co';

export async function paystackRequest(path, { method = 'GET', body } = {}) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw Object.assign(new Error('paystack_not_configured'), { status: 503 });
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    const error = new Error(data?.message || `paystack_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data.data;
}

export const newCheckoutReference = () => `dgp_${crypto.randomBytes(12).toString('hex')}`;

/** Same day next month (clamped to the month's last day), UTC. */
export function addMonth(value) {
  const d = new Date(value);
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

const kobo = (usd, rate) => Math.round(Number(usd) * Number(rate) * 100);
const feeUsd = (feesKobo, rate) => (feesKobo === null || feesKobo === undefined ? null : Math.round((Number(feesKobo) / 100 / Number(rate)) * 100) / 100);

export const CHECKOUT_ERRORS = {
  product_not_available: 'This product is not available any more',
  own_product: 'You cannot buy your own product',
  already_owned: 'You already own this',
  already_subscribed: 'You are already subscribed to this creator',
  plan_not_available: 'This creator does not offer a subscription right now',
  underpaid: 'The price changed before payment completed',
  token_already_used: 'This payment has already been used',
  buyer_not_found: 'Account not found',
};
const knownCode = (error) => Object.keys(CHECKOUT_ERRORS).find((code) => String(error?.message || error?.code || '').includes(code));

/**
 * Starts a Paystack checkout for a digital item (purpose 'purchase') or a
 * creator's monthly plan (purpose 'subscription'; card only, so the card can
 * be charged for renewals).
 */
export async function startDigitalCheckout({ participant, purpose, itemId, creatorUsername, callbackUrl }, deps) {
  if (deps.paused()) return { status: 503, body: { error: 'Digital purchases are paused right now' } };
  let price;
  let tierId;
  let target;
  if (purpose === 'purchase') {
    const found = await deps.loadProduct(itemId);
    if (!found || found.product.status !== 'published' || !found.tier) return { status: 404, body: { error: 'Product not found' } };
    if (found.product.seller_username === participant.username) return { status: 409, body: { error: CHECKOUT_ERRORS.own_product } };
    if (await deps.ownsItem(participant.id, itemId)) return { status: 409, body: { error: CHECKOUT_ERRORS.already_owned, code: 'already_owned' } };
    price = Number(found.tier.price_usd);
    tierId = found.tier.id;
    target = { item_id: itemId };
  } else if (purpose === 'subscription') {
    const found = await deps.loadPlan(creatorUsername);
    if (!found || !found.plan.is_active || !found.tier?.is_active) return { status: 404, body: { error: CHECKOUT_ERRORS.plan_not_available } };
    if (found.plan.creator_username === participant.username) return { status: 409, body: { error: 'You cannot subscribe to yourself' } };
    if (await deps.liveSubscription(participant.id, found.plan.creator_username)) return { status: 409, body: { error: CHECKOUT_ERRORS.already_subscribed, code: 'already_subscribed' } };
    price = Number(found.tier.price_usd);
    tierId = found.tier.id;
    target = { creator_username: found.plan.creator_username };
  } else {
    return { status: 400, body: { error: 'purpose must be purchase or subscription' } };
  }

  const rate = await deps.rate();
  const reference = newCheckoutReference();
  const amountKobo = kobo(price, rate);
  const email = participant.email || deps.fallbackEmail;
  await deps.insertPayment({
    reference, purpose, buyer_id: participant.id, ...target, tier_id: tierId, price_usd: price,
    amount_kobo: amountKobo, exchange_rate: rate, email,
  });
  const init = await deps.initialize({
    email,
    amount: amountKobo,
    currency: 'NGN',
    reference,
    ...(purpose === 'subscription' ? { channels: ['card'] } : {}),
    callback_url: callbackUrl,
    metadata: { type: `digital_${purpose}`, buyer_id: participant.id, ...target, price_usd: price, exchange_rate: rate },
  });
  return {
    status: 200,
    body: { authorization_url: init.authorization_url, reference, amount_ngn: amountKobo / 100, price_usd: price, exchange_rate: rate },
  };
}

/**
 * Confirms a checkout with Paystack and delivers it (licence or subscription).
 * participantId: the logged-in buyer (null for the billing sync).
 */
export async function verifyDigitalCheckout({ reference, participantId = null }, deps) {
  if (!/^dgp_[a-f0-9]{24}$/.test(String(reference || ''))) return { status: 400, body: { error: 'Invalid reference' } };
  const payment = await deps.loadPayment(reference);
  if (!payment || (participantId && payment.buyer_id !== participantId)) return { status: 404, body: { error: 'Payment not found' } };
  if (payment.status === 'paid') {
    return { status: 200, body: { success: true, already_confirmed: true, purpose: payment.purpose, license_id: payment.license_id, subscription_id: payment.subscription_id, item_id: payment.item_id } };
  }
  if (['refund_pending', 'refunded'].includes(payment.status)) {
    return { status: 409, body: { error: `${CHECKOUT_ERRORS[payment.failure] || 'This payment could not be applied'}. It has been refunded.`, refunded: true } };
  }
  if (payment.status === 'failed') return { status: 402, body: { error: 'This payment was not completed' } };

  let tx;
  try {
    tx = await deps.fetchTransaction(reference);
  } catch (error) {
    if ([400, 404].includes(error?.status)) return { status: 202, body: { pending: true, error: 'Payment not completed yet' } };
    throw error;
  }
  const ageMs = deps.now() - new Date(payment.created_at).getTime();
  if (tx.status !== 'success') {
    if (['failed', 'reversed'].includes(tx.status) || (tx.status === 'abandoned' && ageMs > 24 * 3600 * 1000)) {
      await deps.updatePayment(reference, { status: 'failed', failure: tx.gateway_response || tx.status }, 'initialized');
      return { status: 402, body: { error: 'This payment was not completed' } };
    }
    return { status: 202, body: { pending: true, error: 'Payment not completed yet' } };
  }

  const txId = tx.id === undefined || tx.id === null ? null : String(tx.id);
  if (tx.reference !== reference || String(tx.currency || '').toUpperCase() !== 'NGN' || !(Number(tx.amount) >= Number(payment.amount_kobo))) {
    return refundAndFail(payment, 'amount_mismatch', txId, deps);
  }
  const fee = feeUsd(tx.fees, payment.exchange_rate);

  const result = { status: 'paid', verified_at: new Date(deps.now()).toISOString(), paystack_transaction_id: txId, fees_kobo: tx.fees ?? null };
  try {
    if (payment.purpose === 'purchase') {
      result.license_id = await deps.grantLicense({
        buyerId: payment.buyer_id, itemId: payment.item_id, paidTierId: payment.tier_id, providerRef: reference, orderId: txId, feeUsd: fee,
      });
    } else {
      const auth = tx.authorization || {};
      const reusable = auth.reusable === true && !!auth.authorization_code;
      const start = new Date(tx.paid_at || deps.now());
      const end = addMonth(start);
      result.subscription_id = await deps.startSubscription({
        subscriberId: payment.buyer_id, creatorUsername: payment.creator_username, providerRef: reference, paidTierId: payment.tier_id,
        periodStart: start.toISOString(), periodEnd: end.toISOString(), autoRenew: reusable,
        authorizationCode: reusable ? auth.authorization_code : null, email: tx.customer?.email || payment.email,
      });
      await deps.recordSubscriptionPayment({
        subscriptionId: result.subscription_id, providerRef: reference, providerTxnId: txId,
        periodStart: start.toISOString(), periodEnd: end.toISOString(), grossUsd: Number(payment.price_usd), feeUsd: fee,
      });
    }
  } catch (error) {
    const code = knownCode(error);
    if (!code) throw error;
    return refundAndFail(payment, code, txId, deps);
  }
  await deps.updatePayment(reference, result);
  return {
    status: 200,
    body: { success: true, purpose: payment.purpose, license_id: result.license_id || null, subscription_id: result.subscription_id || null, item_id: payment.item_id },
  };
}

async function refundAndFail(payment, code, txId, deps) {
  // Only the caller that moves the row out of 'initialized' issues the refund.
  const claimed = await deps.updatePayment(payment.reference, { status: 'refund_pending', failure: code, paystack_transaction_id: txId }, 'initialized');
  if (claimed) {
    try {
      await deps.refund(payment.reference);
      await deps.updatePayment(payment.reference, { status: 'refunded' }, 'refund_pending');
    } catch (error) {
      console.error('digital paystack refund failed (left as refund_pending for admin):', payment.reference, error.message);
    }
  }
  return { status: 409, body: { error: `${CHECKOUT_ERRORS[code] || 'This payment could not be applied'}. Your payment is being refunded.`, code, refunded: true } };
}

function metadataRate(tx) {
  let metadata = tx?.metadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = null; } }
  return Number(metadata?.exchange_rate) || null;
}

const IN_FLIGHT = new Set(['ongoing', 'pending', 'processing', 'queued', 'send_otp', 'send_pin', 'send_birthday', 'send_phone', 'send_address', 'open_url']);

/**
 * Renews one website subscription by charging the saved card. Called by the
 * daily billing sync for subscriptions ending within a day. A charge whose
 * result is unknown is checked before any new attempt, so a card is never
 * charged twice for one month.
 * Returns 'renewed' | 'failed' | 'pending' | 'not_due' | 'skipped' | 'error'.
 */
export async function renewWebSubscription(sub, deps) {
  if (sub.provider !== 'paystack' || !['active', 'past_due'].includes(sub.status)) return 'skipped';
  if (!sub.auto_renew || !sub.paystack_authorization_code) return 'skipped';
  if (!(await deps.planActive(sub.creator_username))) {
    await deps.updateSubscription(sub.id, { auto_renew: false, end_reason: 'creator ended the plan' });
    return 'skipped';
  }
  const periodStart = new Date(sub.current_period_end);
  const periodEnd = addMonth(periodStart);
  const record = (tx, ref, rate) => deps.recordSubscriptionPayment({
    subscriptionId: sub.id, providerRef: ref, providerTxnId: tx.id === undefined || tx.id === null ? null : String(tx.id),
    periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), grossUsd: Number(sub.price_usd),
    feeUsd: rate ? feeUsd(tx.fees, rate) : null,
  });

  if (sub.last_charge_reference) {
    let previous = null;
    try {
      previous = await deps.fetchTransaction(sub.last_charge_reference);
    } catch (error) {
      if (![400, 404].includes(error?.status)) return 'error';
    }
    if (previous?.status === 'success') { await record(previous, sub.last_charge_reference, metadataRate(previous)); return 'renewed'; }
    if (previous && IN_FLIGHT.has(previous.status)) return 'pending';
  }

  if (periodStart.getTime() - deps.now() > 24 * 3600 * 1000) return 'not_due';

  const attempt = Number(sub.renewal_attempts || 0) + 1;
  const reference = `dgr_${sub.id.replace(/-/g, '')}_${await deps.countPayments(sub.id)}_${attempt}`;
  // Persist the reference before charging: if the response is lost, the next run checks it.
  await deps.updateSubscription(sub.id, { last_charge_reference: reference, renewal_attempts: attempt });
  const rate = await deps.rate();
  const overdue = periodStart.getTime() <= deps.now();
  let tx;
  try {
    tx = await deps.chargeAuthorization({
      authorization_code: sub.paystack_authorization_code,
      email: sub.paystack_email,
      amount: kobo(sub.price_usd, rate),
      currency: 'NGN',
      reference,
      metadata: { type: 'digital_subscription_renewal', subscription_id: sub.id, creator_username: sub.creator_username, price_usd: Number(sub.price_usd), exchange_rate: rate },
    });
  } catch (error) {
    await deps.updateSubscription(sub.id, { last_renewal_error: String(error.message || 'charge failed').slice(0, 300), ...(overdue ? { status: 'past_due' } : {}) });
    return 'error';
  }
  if (tx.status === 'success') {
    await record(tx, reference, rate);
    return 'renewed';
  }
  if (IN_FLIGHT.has(tx.status)) return 'pending';
  await deps.updateSubscription(sub.id, {
    last_charge_reference: null,
    last_renewal_error: String(tx.gateway_response || tx.status || 'declined').slice(0, 300),
    ...(overdue ? { status: 'past_due' } : {}),
  });
  return 'failed';
}

/** Matches a Paystack refund to a digital payment reference (if it is one of ours). */
export function refundReference(refund) {
  const tx = refund?.transaction;
  return {
    reference: refund?.transaction_reference || (tx && typeof tx === 'object' ? tx.reference : null) || null,
    transactionId: tx === undefined || tx === null ? null : String(typeof tx === 'object' ? tx.id : tx),
  };
}
