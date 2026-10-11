// Daily billing job for digital products, phase 2 (Vercel cron with
// CRON_SECRET, or an admin with POST). Each step is independent and reported:
//   1. confirm website (Paystack) checkouts the buyer never returned from
//   2. retry refunds of checkouts that could not be delivered
//   3. apply Paystack refunds: licence revoked / subscription month reversed
//   4. renew website subscriptions due within a day (saved card; never twice)
//   5. end website subscriptions that lapsed (renewal failed 3 days, or cancelled)
//   6. refresh Google Play subscriptions whose period ended (renewal / expiry)
//   7. apply Google Play subscription refunds (voided purchases)
// Touches only digital_* tables. AI subscriptions, ads, wallet and escrow are
// not read or changed (unknown Paystack refunds / Google tokens are ignored).
//   GET (cron) | POST { days? } (admin)

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb, digitalSalesPaused } from '../../../../lib/digital';
import { paystackDeps, refreshGoogleSubscriptionRow } from '../../../../lib/digitalBilling';
import { paystackRequest, refundReference, renewWebSubscription, verifyDigitalCheckout } from '../../../../lib/digitalPaystack';
import { listVoidedSubscriptionPurchases } from '../../../../lib/digitalSubscriptions';

export const config = { maxDuration: 60 };

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data || []; };

async function step(report, name, fn) {
  try {
    report[name] = await fn();
  } catch (error) {
    console.error(`digital billing-sync ${name}:`, error.message || error);
    report[name] = { error: ['paystack_not_configured', 'google_play_not_configured', 'invalid_google_play_credentials'].includes(error.message) ? error.message : 'failed' };
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    const admin = await requireActiveAdmin(req, res, digitalDb);
    if (!admin) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  }
  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 60);
  const now = Date.now();
  const report = {};
  const hasPaystack = !!process.env.PAYSTACK_SECRET_KEY;

  if (hasPaystack) {
    await step(report, 'checkouts_confirmed', async () => {
      const rows = must(await digitalDb.from('digital_paystack_payments').select('reference').eq('status', 'initialized')
        .gte('created_at', new Date(now - 72 * 3600e3).toISOString()).lte('created_at', new Date(now - 5 * 60e3).toISOString()).limit(100));
      const out = { checked: rows.length, delivered: 0, refunded: 0, failed: 0 };
      for (const { reference } of rows) {
        const r = await verifyDigitalCheckout({ reference }, paystackDeps).catch(() => ({ status: 0 }));
        if (r.status === 200) out.delivered += 1;
        else if (r.body?.refunded) out.refunded += 1;
        else if (r.status === 402) out.failed += 1;
      }
      // Older than 72 h and never paid: closed.
      await digitalDb.from('digital_paystack_payments').update({ status: 'failed', failure: 'not paid' })
        .eq('status', 'initialized').lt('created_at', new Date(now - 72 * 3600e3).toISOString());
      return out;
    });

    await step(report, 'refunds_retried', async () => {
      const rows = must(await digitalDb.from('digital_paystack_payments').select('reference').eq('status', 'refund_pending').limit(50));
      let done = 0;
      for (const { reference } of rows) {
        try {
          await paystackDeps.refund(reference);
          await paystackDeps.updatePayment(reference, { status: 'refunded' }, 'refund_pending');
          done += 1;
        } catch (error) {
          // Already refunded at Paystack (e.g. by an admin): close it.
          if (/fully refunded|already been refunded|reversed/i.test(error.message)) {
            await paystackDeps.updatePayment(reference, { status: 'refunded' }, 'refund_pending');
            done += 1;
          }
        }
      }
      return { pending: rows.length, refunded: done };
    });

    await step(report, 'paystack_refunds', async () => {
      const from = new Date(now - days * 24 * 3600e3).toISOString();
      const out = { seen: 0, licences_revoked: 0, months_reversed: 0 };
      for (let page = 1; page <= 10; page += 1) {
        const refunds = await paystackRequest(`/refund?${new URLSearchParams({ from, perPage: '100', page: String(page) })}`);
        if (!Array.isArray(refunds) || !refunds.length) break;
        for (const refund of refunds) {
          if (String(refund.status || '').toLowerCase() === 'failed') continue;
          out.seen += 1;
          const { reference, transactionId } = refundReference(refund);
          const reason = `Paystack refund ${refund.id || ''}`.trim();
          let checkout = null;
          if (reference?.startsWith('dgp_')) checkout = (must(await digitalDb.from('digital_paystack_payments').select('*').eq('reference', reference).limit(1)))[0];
          else if (transactionId) checkout = (must(await digitalDb.from('digital_paystack_payments').select('*').eq('paystack_transaction_id', transactionId).limit(1)))[0];
          if (checkout?.status === 'refund_pending') await paystackDeps.updatePayment(checkout.reference, { status: 'refunded' }, 'refund_pending');
          if (checkout?.purpose === 'purchase' && checkout.status === 'paid') {
            const { data } = await digitalDb.rpc('digital_revoke_license', { p_provider: 'paystack', p_provider_ref: checkout.reference, p_status: 'refunded', p_reason: reason });
            out.licences_revoked += data || 0;
          }
          // Subscription months: the first month (dgp_) or a renewal (dgr_), by reference or transaction id.
          let monthRef = checkout?.purpose === 'subscription' ? checkout.reference : reference?.startsWith('dgr_') ? reference : null;
          if (!monthRef && transactionId) {
            monthRef = (must(await digitalDb.from('digital_subscription_payments').select('provider_ref').eq('provider', 'paystack').eq('provider_txn_id', transactionId).limit(1)))[0]?.provider_ref || null;
          }
          if (monthRef) {
            const { data } = await digitalDb.rpc('digital_revoke_subscription_payment', { p_provider: 'paystack', p_provider_ref: monthRef, p_reason: reason });
            out.months_reversed += data || 0;
          }
        }
        if (refunds.length < 100) break;
      }
      return out;
    });

    await step(report, 'web_renewals', async () => {
      // Emergency stop: no card is charged while DIGITAL_SALES_PAUSED=true (retried once lifted, within the 3-day grace).
      if (digitalSalesPaused()) return 'paused (DIGITAL_SALES_PAUSED)';
      const subs = must(await digitalDb.from('digital_subscriptions').select('*').eq('provider', 'paystack').in('status', ['active', 'past_due'])
        .eq('auto_renew', true).lte('current_period_end', new Date(now + 24 * 3600e3).toISOString()).limit(200));
      const out = {};
      for (const sub of subs) {
        const result = await renewWebSubscription(sub, paystackDeps).catch((e) => { console.error('renewal error', sub.id, e.message); return 'error'; });
        out[result] = (out[result] || 0) + 1;
      }
      return out;
    });
  } else {
    report.paystack = 'PAYSTACK_SECRET_KEY not set - website steps skipped';
  }

  await step(report, 'lapsed_ended', async () => {
    const { data, error } = await digitalDb.rpc('digital_expire_subscriptions');
    if (error) throw new Error(error.message);
    return data || 0;
  });

  await step(report, 'google_refreshed', async () => {
    const rows = must(await digitalDb.from('digital_subscriptions').select('*').eq('provider', 'google_play').in('status', ['active', 'past_due'])
      .lte('current_period_end', new Date(now + 5 * 60e3).toISOString()).limit(200));
    const out = { checked: rows.length, active: 0, ended: 0, errors: 0 };
    for (const row of rows) {
      try {
        const r = await refreshGoogleSubscriptionRow(row);
        if (r.status === 'active') out.active += 1; else out.ended += 1;
      } catch (error) {
        out.errors += 1;
        if (['google_play_not_configured', 'invalid_google_play_credentials'].includes(error.message)) throw error;
      }
    }
    return out;
  });

  await step(report, 'google_refunds', async () => {
    const voided = await listVoidedSubscriptionPurchases(now - days * 24 * 3600e3);
    const out = { seen: voided.length, months_reversed: 0, ended: 0 };
    for (const v of voided) {
      const reason = `Google Play voided purchase (order ${v.orderId || 'n/a'})`;
      let reversed = 0;
      if (v.orderId) {
        const { data } = await digitalDb.rpc('digital_revoke_subscription_payment', { p_provider: 'google_play', p_provider_ref: v.orderId, p_reason: reason });
        reversed = data || 0;
        out.months_reversed += reversed;
      }
      if (!reversed && v.purchaseToken) {
        const sub = (must(await digitalDb.from('digital_subscriptions').select('id').eq('provider', 'google_play').eq('provider_ref', v.purchaseToken).limit(1)))[0];
        if (sub) {
          const { data } = await digitalDb.rpc('digital_end_subscription', { p_subscription_id: sub.id, p_status: 'revoked', p_reason: reason });
          out.ended += data || 0;
        }
      }
    }
    return out;
  });

  return res.status(200).json(report);
}
