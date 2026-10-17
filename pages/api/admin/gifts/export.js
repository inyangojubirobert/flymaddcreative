// CSV export for finance / operations review (admin only).
//   GET ?type=purchases|gifts|ledger|audit&days=90  (max 365 days, 20,000 rows)

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { giftsDb } from '../../../../lib/dreamCoins';

const EXPORTS = {
  purchases: { table: 'dream_coin_purchases', order: 'created_at', columns: ['id', 'participant_id', 'package_id', 'product_id', 'order_id', 'quantity', 'coins_per_unit', 'total_coins', 'is_test', 'status', 'reversed_quantity', 'consumption_state', 'purchased_at', 'created_at'] },
  gifts: { table: 'virtual_gift_transactions', order: 'created_at', columns: ['id', 'sender_id', 'recipient_id', 'gift_id', 'quantity', 'unit_cost', 'coins_spent', 'recognition_points', 'context_type', 'context_ref', 'verified_buyer', 'is_anonymous', 'status', 'created_at'] },
  ledger: { table: 'dream_coin_ledger', order: 'created_at', columns: ['id', 'participant_id', 'entry_type', 'coins', 'balance_after', 'purchase_id', 'gift_transaction_id', 'note', 'admin_id', 'created_at'] },
  audit: { table: 'dream_gifting_admin_audit', order: 'created_at', columns: ['id', 'admin_id', 'action', 'target_type', 'target_id', 'details', 'created_at'] },
};

const cell = (value) => {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Quote everything; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;

  const spec = EXPORTS[String(req.query.type || '')];
  if (!spec) return res.status(400).json({ error: `type must be one of ${Object.keys(EXPORTS).join(', ')}` });
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);

  try {
    const { data, error } = await giftsDb.from(spec.table).select(spec.columns.join(', '))
      .gte(spec.order, new Date(Date.now() - days * 86400e3).toISOString()).order(spec.order, { ascending: false }).limit(20000);
    if (error) throw error;
    const csv = [spec.columns.join(','), ...(data || []).map((row) => spec.columns.map((c) => cell(row[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dream-${req.query.type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('admin/gifts/export error:', error);
    return res.status(500).json({ error: 'Export failed' });
  }
}
