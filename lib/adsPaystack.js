// Website (Paystack card) purchases of advertising and boost packages, for the
// web app where Google Play billing doesn't exist. Mirrors the digital-product
// checkout (lib/digitalPaystack.js): own reference prefix (adp_), own table
// (ad_paystack_payments), no webhook. A payment is confirmed by
//   1. the buyer's return from checkout (POST /api/ads/paystack-verify),
//   2. the daily ads job (pages/api/admin/ads/sync-voided), which re-checks
//      unconfirmed checkouts and applies Paystack refunds.
// Both call verifyAdCheckout(), which is idempotent.
//
// Binding: the server creates the checkout for the logged-in buyer and one
// package at the server's price; Paystack's verified amount must cover it.
// The entitlement snapshot is the package as it was at checkout.
// Rules are separated from I/O (deps injected) so they can be tested.

import crypto from 'crypto';
import { adsDb, packageSnapshot } from './ads';
import { promotionalBillingPaused } from './adsGooglePlay';
import { getUsdToNgnRate } from './currency';
import { paystackRequest } from './digitalPaystack';

export const newAdReference = () => `adp_${crypto.randomBytes(12).toString('hex')}`;
export const isAdReference = (value) => /^adp_[a-f0-9]{24}$/.test(String(value || ''));

const kobo = (usd, rate) => Math.round(Number(usd) * Number(rate) * 100);

/** Packages can be bought by card when active and billing isn't paused (no Play product needed). */
export const cardPurchasable = (pkg) => !!pkg?.is_active && !promotionalBillingPaused();

export async function startAdCheckout({ participant, packageId, callbackUrl }, deps) {
  if (deps.paused()) return { status: 503, body: { error: 'Buying packages is paused right now' } };
  const pkg = await deps.loadPackage(packageId);
  if (!pkg || !pkg.is_active) return { status: 404, body: { error: 'Package not found' } };

  const price = Number(pkg.price_usd);
  const rate = await deps.rate();
  const reference = newAdReference();
  const amountKobo = kobo(price, rate);
  const email = participant.email || deps.fallbackEmail;
  await deps.insertPayment({
    reference, buyer_id: participant.id, package_id: pkg.id, package_snapshot: packageSnapshot(pkg),
    price_usd: price, amount_kobo: amountKobo, exchange_rate: rate, email,
  });
  const init = await deps.initialize({
    email,
    amount: amountKobo,
    currency: 'NGN',
    reference,
    callback_url: callbackUrl,
    metadata: { type: 'ad_package', buyer_id: participant.id, package_id: pkg.id, price_usd: price, exchange_rate: rate },
  });
  return { status: 200, body: { authorization_url: init.authorization_url, reference, amount_ngn: amountKobo / 100, price_usd: price, exchange_rate: rate } };
}

/** participantId: the logged-in buyer (null for the daily job). */
export async function verifyAdCheckout({ reference, participantId = null }, deps) {
  if (!isAdReference(reference)) return { status: 400, body: { error: 'Invalid reference' } };
  const payment = await deps.loadPayment(reference);
  if (!payment || (participantId && payment.buyer_id !== participantId)) return { status: 404, body: { error: 'Payment not found' } };
  if (payment.status === 'paid') return { status: 200, body: { success: true, already_confirmed: true, entitlement_id: payment.entitlement_id } };
  if (['refund_pending', 'refunded'].includes(payment.status)) return { status: 409, body: { error: 'This payment could not be applied. It has been refunded.', refunded: true } };
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
    const claimed = await deps.updatePayment(reference, { status: 'refund_pending', failure: 'amount_mismatch', paystack_transaction_id: txId }, 'initialized');
    if (claimed) {
      try {
        await deps.refund(reference);
        await deps.updatePayment(reference, { status: 'refunded' }, 'refund_pending');
      } catch (error) {
        console.error('ad paystack refund failed (left as refund_pending):', reference, error.message);
      }
    }
    return { status: 409, body: { error: 'The price changed before payment completed. Your payment is being refunded.', refunded: true } };
  }

  // Unique (provider, provider_ref): a concurrent confirmation resolves to the same entitlement.
  const entitlementId = await deps.grantEntitlement({
    participant_id: payment.buyer_id,
    package_id: payment.package_id,
    package_snapshot: payment.package_snapshot,
    provider: 'paystack',
    provider_ref: reference,
    order_id: txId,
    price_usd: Number(payment.price_usd),
    is_paid: true,
    status: 'available',
  });
  await deps.updatePayment(reference, {
    status: 'paid', verified_at: new Date(deps.now()).toISOString(), paystack_transaction_id: txId, fees_kobo: tx.fees ?? null, entitlement_id: entitlementId,
  });
  return { status: 200, body: { success: true, entitlement_id: entitlementId } };
}

const must = ({ data, error }) => { if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data; };

export const adPaystackDeps = {
  paused: promotionalBillingPaused,
  now: () => Date.now(),
  fallbackEmail: 'support@flymaddcreative.online',
  rate: getUsdToNgnRate,
  async loadPackage(id) {
    return must(await adsDb.from('advertising_packages').select('*').eq('id', String(id || '')).maybeSingle());
  },
  async insertPayment(row) { must(await adsDb.from('ad_paystack_payments').insert(row)); },
  initialize: (body) => paystackRequest('/transaction/initialize', { method: 'POST', body }),
  async loadPayment(reference) {
    return must(await adsDb.from('ad_paystack_payments').select('*').eq('reference', reference).maybeSingle());
  },
  fetchTransaction: (reference) => paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`),
  /** Conditional update (expectStatus): returns the row only if it was in that status. */
  async updatePayment(reference, fields, expectStatus) {
    let query = adsDb.from('ad_paystack_payments').update(fields).eq('reference', reference);
    if (expectStatus) query = query.eq('status', expectStatus);
    return must(await query.select('reference').maybeSingle());
  },
  refund: (reference) => paystackRequest('/refund', { method: 'POST', body: { transaction: reference, merchant_note: 'One Dream advertising package could not be applied' } }),
  async grantEntitlement(row) {
    const { data, error } = await adsDb.from('advertising_entitlements').insert(row).select('id').single();
    if (error?.code === '23505') {
      return must(await adsDb.from('advertising_entitlements').select('id').eq('provider', 'paystack').eq('provider_ref', row.provider_ref).single()).id;
    }
    if (error) throw new Error(error.message);
    return data.id;
  },
};
