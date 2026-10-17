// P6 reconciliation job: completes successful Paystack CART payments whose
// buyer never came back, using the buyer details stored at payment-intent
// time (catalogue_pending_checkouts). Inert until P6 is approved and applied
// (docs/protected-patches/P6_*): without that table it reports and stops.
//   GET  (Vercel cron, Authorization: Bearer <CRON_SECRET>)
//   POST (admin portal)
// It runs the existing cart-checkout handler itself, so the payment is
// verified with Paystack and the orders are written by exactly the same code
// and database transaction as a normal checkout (idempotent by reference).

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { earningsDb } from '../../../../lib/earnings';
import cartCheckout from '../../catalogue/cart-checkout';

export const config = { maxDuration: 60 };

/** Calls a Next API handler in-process and returns { status, body }. */
function invoke(handler, body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      setHeader() { return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler({ method: 'POST', body, headers: {}, query: {} }, res)).catch(reject);
  });
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    if (req.method === 'GET') return res.status(405).json({ error: 'Use POST' });
    const admin = await requireActiveAdmin(req, res, earningsDb);
    if (!admin) return;
  }

  try {
    const { data: pending, error } = await earningsDb.from('catalogue_pending_checkouts')
      .select('payment_ref, buyer, created_at').is('completed_at', null)
      .lt('created_at', new Date(Date.now() - 30 * 60e3).toISOString())
      .gt('created_at', new Date(Date.now() - 30 * 86400e3).toISOString())
      .order('created_at').limit(50);
    if (error) {
      if (/catalogue_pending_checkouts/.test(error.message || '')) return res.status(200).json({ active: false, note: 'P6 is not applied' });
      throw error;
    }

    const results = [];
    for (const row of pending || []) {
      const { data: done } = await earningsDb.from('catalogue_checkouts').select('id').eq('payment_ref', row.payment_ref).maybeSingle();
      if (done) {
        await earningsDb.from('catalogue_pending_checkouts').update({ completed_at: new Date().toISOString(), completed_by: 'buyer' }).eq('payment_ref', row.payment_ref);
        results.push({ payment_ref: row.payment_ref, outcome: 'already_completed' });
        continue;
      }
      const b = row.buyer || {};
      const outcome = await invoke(cartCheckout, {
        payment_method: 'paystack',
        payment_ref: row.payment_ref,
        buyer_name: b.buyer_name,
        buyer_email: b.buyer_email,
        buyer_whatsapp: b.buyer_whatsapp,
        delivery_address: b.delivery_address || undefined,
        notes: b.notes || undefined,
      });
      if (outcome.status === 200) {
        await earningsDb.from('catalogue_pending_checkouts').update({ completed_at: new Date().toISOString(), completed_by: 'reconciliation' }).eq('payment_ref', row.payment_ref);
      }
      // 400 "Payment verification failed" = never paid (abandoned): left open until it ages out.
      results.push({ payment_ref: row.payment_ref, outcome: outcome.status === 200 ? 'completed' : `skipped_${outcome.status}`, detail: outcome.status === 200 ? null : outcome.body?.error });
    }
    // Personal data is not kept longer than needed.
    await earningsDb.from('catalogue_pending_checkouts').delete().lt('created_at', new Date(Date.now() - 60 * 86400e3).toISOString());
    return res.status(200).json({ active: true, checked: results.length, completed: results.filter((r) => r.outcome === 'completed').length, results });
  } catch (error) {
    console.error('admin/earnings/complete-unreturned error:', error.message || error);
    return res.status(500).json({ error: 'Reconciliation failed' });
  }
}
