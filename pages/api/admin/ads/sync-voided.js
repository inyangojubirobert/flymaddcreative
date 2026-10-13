// Applies Google Play refunds / chargebacks / revocations to advertising
// entitlements: the entitlement is marked refunded and its campaign ends.
// Also handles website (Paystack card) package purchases: confirms checkouts
// the buyer never returned from, and applies Paystack refunds the same way.
// Run from the admin portal, or schedule it (send Authorization: Bearer
// <CRON_SECRET>). Only one-time product purchases are listed, so the AI
// subscription is unaffected.
//   POST { days } (default 30, max 30 - Google's voided-purchases window)
//   GET  (Vercel cron, daily - see vercel.json) uses the 30-day window

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';
import { listVoidedProductPurchases } from '../../../../lib/adsGooglePlay';
import { adPaystackDeps, isAdReference, verifyAdCheckout } from '../../../../lib/adsPaystack';
import { paystackRequest, refundReference } from '../../../../lib/digitalPaystack';

export const config = { maxDuration: 60 };

const REASONS = { 0: 'other', 1: 'remorse', 2: 'not received', 3: 'defective', 4: 'accidental purchase', 5: 'fraud', 6: 'friendly fraud', 7: 'chargeback' };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    const admin = await requireActiveAdmin(req, res, adsDb);
    if (!admin) return;
  }

  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 30);
  if (req.method === 'GET' && !isCron) return res.status(405).json({ error: 'Use POST' });
  const card = process.env.PAYSTACK_SECRET_KEY ? await syncCardPurchases(days).catch((error) => {
    console.error('admin/ads/sync-voided card purchases:', error.message || error);
    return { error: 'failed' };
  }) : null;

  try {
    const voided = await listVoidedProductPurchases(Date.now() - days * 24 * 60 * 60 * 1000);
    let revoked = 0;
    for (const purchase of voided) {
      const { data, error } = await adsDb.rpc('ads_revoke_entitlement', {
        p_provider: 'google_play',
        p_provider_ref: purchase.purchaseToken,
        p_status: 'refunded',
        p_reason: `Google Play voided purchase (${REASONS[purchase.voidedReason] || 'unknown'}, order ${purchase.orderId || 'n/a'})`,
      });
      if (error) throw error;
      revoked += data || 0;
    }
    return res.status(200).json({ checked: voided.length, revoked, card });
  } catch (error) {
    console.error('admin/ads/sync-voided error:', error.message || error);
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play is not configured' : 'Could not fetch voided purchases', card });
  }
}

const rows = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data || [];
};

/** Website (Paystack) package purchases: confirm unreturned checkouts, apply refunds. */
async function syncCardPurchases(days) {
  const now = Date.now();
  const out = { confirmed: 0, failed: 0, refunds_seen: 0, revoked: 0 };

  const pending = rows(await adsDb.from('ad_paystack_payments').select('reference').eq('status', 'initialized')
    .gte('created_at', new Date(now - 72 * 3600e3).toISOString()).lte('created_at', new Date(now - 5 * 60e3).toISOString()).limit(100));
  for (const { reference } of pending) {
    const result = await verifyAdCheckout({ reference }, adPaystackDeps).catch(() => ({ status: 0 }));
    if (result.status === 200) out.confirmed += 1;
    else if (result.status === 402) out.failed += 1;
  }
  // Older than 72 h and never paid: closed.
  await adsDb.from('ad_paystack_payments').update({ status: 'failed', failure: 'not paid' })
    .eq('status', 'initialized').lt('created_at', new Date(now - 72 * 3600e3).toISOString());

  const from = new Date(now - Math.max(days, 30) * 24 * 3600e3).toISOString();
  for (let page = 1; page <= 10; page += 1) {
    const refunds = await paystackRequest(`/refund?${new URLSearchParams({ from, perPage: '100', page: String(page) })}`);
    if (!Array.isArray(refunds) || !refunds.length) break;
    for (const refund of refunds) {
      if (String(refund.status || '').toLowerCase() === 'failed') continue;
      const { reference, transactionId } = refundReference(refund);
      let payment = null;
      if (isAdReference(reference)) payment = rows(await adsDb.from('ad_paystack_payments').select('reference, status').eq('reference', reference).limit(1))[0];
      else if (transactionId) payment = rows(await adsDb.from('ad_paystack_payments').select('reference, status').eq('paystack_transaction_id', transactionId).limit(1))[0];
      if (!payment) continue; // not an ad package payment (votes, marketplace, digital...)
      out.refunds_seen += 1;
      if (payment.status === 'refund_pending') await adPaystackDeps.updatePayment(payment.reference, { status: 'refunded' }, 'refund_pending');
      if (payment.status === 'paid') {
        const { data, error } = await adsDb.rpc('ads_revoke_entitlement', {
          p_provider: 'paystack', p_provider_ref: payment.reference, p_status: 'refunded', p_reason: `Paystack refund ${refund.id || ''}`.trim(),
        });
        if (error) throw error;
        out.revoked += data || 0;
      }
    }
    if (refunds.length < 100) break;
  }
  return out;
}
