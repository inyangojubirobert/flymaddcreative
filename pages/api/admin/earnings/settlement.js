// Admin: Google Play settlement for Dream Coin gift earnings.
//   POST { action: 'import', report_month: 'YYYY-MM', csv, source_name? }
//        Imports a Play Console earnings report (Download reports > Financial >
//        Earnings, USD). Only Dream Coin product rows are kept; re-importing
//        the same rows adds nothing. Lots are re-valued at their real Google
//        fee and tax, and their gift earnings are adjusted (provisional -> final).
//   POST { action: 'mark_funds', batch_id, payout_reference }
//        Google's payout for that report has reached One Dream's bank: the
//        gift earnings funded by its lots become withdrawable.
// Purchase verification, Google's report and money in the bank are three
// different events; only the last makes earnings withdrawable.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { earningsDb, must } from '../../../../lib/earnings';
import { coinRowsOnly, parsePlayEarningsReport } from '../../../../lib/earningsRules';

export const config = { api: { bodyParser: { sizeLimit: '8mb' } }, maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, earningsDb);
  if (!admin) return;

  try {
    if (req.body?.action === 'import') {
      const month = String(req.body.report_month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'report_month: YYYY-MM' });
      const parsed = parsePlayEarningsReport(String(req.body.csv || ''));
      if (!parsed.rows.length) return res.status(400).json({ error: parsed.errors.slice(0, 5).join('; ') || 'No rows found' });
      const products = must(await earningsDb.from('dream_coin_packages').select('google_play_product_id')).map((p) => p.google_play_product_id);
      const rows = coinRowsOnly(parsed.rows, products);
      if (!rows.length) return res.status(400).json({ error: 'The report has no Dream Coin rows' });
      const { data, error } = await earningsDb.rpc('play_settlement_import', {
        p_report_month: month, p_source_name: String(req.body.source_name || '').slice(0, 200), p_rows: rows, p_admin: admin.id,
      });
      if (error) throw error;
      return res.status(200).json({ ...data, rows_in_report: parsed.rows.length, coin_rows: rows.length, warnings: parsed.errors.slice(0, 20) });
    }
    if (req.body?.action === 'mark_funds') {
      const reference = String(req.body.payout_reference || '').trim();
      if (reference.length < 3) return res.status(400).json({ error: 'Enter the bank / Google payout reference' });
      const { data, error } = await earningsDb.rpc('play_settlement_mark_funds', {
        p_batch: String(req.body.batch_id || ''), p_admin: admin.id, p_reference: reference,
      });
      if (error) return res.status(String(error.message).includes('batch_not_found') ? 404 : 500).json({ error: error.message });
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('admin/earnings/settlement error:', error);
    return res.status(500).json({ error: 'Settlement update failed' });
  }
}
