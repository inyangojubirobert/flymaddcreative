// Monitor (read only): successful Paystack marketplace payments that never
// became an order, because the buyer did not come back to the app or page
// after paying. Nothing is created or changed here; completing these orders
// automatically is the separately authorised change P6
// (docs/protected-patches/P6_reconcile_unreturned_paystack.md).
//   GET ?days=7 (max 30)  (admin, or cron with CRON_SECRET)
// For carts the lines are in the Paystack metadata, so P6 can rebuild the
// orders; single-listing payments carry no buyer contact details and need
// support to reach the buyer (Paystack's customer email).

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { earningsDb, must } from '../../../../lib/earnings';
import { paystackRequest } from '../../../../lib/digitalPaystack';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    const admin = await requireActiveAdmin(req, res, earningsDb);
    if (!admin) return;
  }
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const from = new Date(Date.now() - days * 86400e3).toISOString();
  // Payments younger than 30 minutes may simply still be returning.
  const settleBefore = Date.now() - 30 * 60e3;

  try {
    const candidates = [];
    for (let page = 1; page <= 10; page += 1) {
      const txs = await paystackRequest(`/transaction?${new URLSearchParams({ status: 'success', from, perPage: '100', page: String(page) })}`);
      if (!Array.isArray(txs) || !txs.length) break;
      for (const tx of txs) {
        const type = tx.metadata?.type;
        if (!['catalogue_cart', 'catalogue_purchase'].includes(type)) continue;
        if (new Date(tx.paid_at || tx.created_at).getTime() > settleBefore) continue;
        candidates.push({ reference: tx.reference, type, amount_kobo: tx.amount, paid_at: tx.paid_at, customer_email: tx.customer?.email || null,
                          item_id: tx.metadata?.item_id || null, lines: tx.metadata?.lines || null });
      }
      if (txs.length < 100) break;
    }
    const refs = candidates.map((c) => c.reference);
    const [checkouts, orders] = refs.length ? await Promise.all([
      earningsDb.from('catalogue_checkouts').select('payment_ref').in('payment_ref', refs).then(must),
      earningsDb.from('catalogue_orders').select('payment_ref').in('payment_ref', refs).then(must),
    ]) : [[], []];
    const done = new Set([...checkouts, ...orders].map((r) => r.payment_ref));
    const orphans = candidates.filter((c) => !done.has(c.reference)).map((c) => ({
      ...c,
      recoverable_automatically: c.type === 'catalogue_cart' && Array.isArray(c.lines) && c.lines.length > 0,
    }));
    return res.status(200).json({ checked: candidates.length, orphans, days });
  } catch (error) {
    console.error('admin/earnings/orphans error:', error.message || error);
    const notConfigured = error?.message === 'paystack_not_configured';
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Paystack is not configured' : 'Could not check Paystack' });
  }
}
