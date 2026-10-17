// CSV export for finance review (admin only).
//   GET ?type=ledger|gift_earnings|lots|settlement|attributions|referral_rewards|payouts&days=90

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { earningsDb } from '../../../../lib/earnings';

const EXPORTS = {
  ledger: { table: 'partner_ledger', order: 'created_at', columns: ['id', 'party_type', 'party_id', 'source', 'bucket', 'amount_micro', 'entry_type', 'ref_type', 'ref_id', 'note', 'admin_id', 'created_at'] },
  gift_earnings: { table: 'gift_earning_components', order: 'gift_transaction_id', since: false,
    columns: ['gift_transaction_id', 'lot_id', 'coins', 'provisional_value_micro', 'final_value_micro', 'recipient_micro', 'merchant_micro', 'platform_micro', 'reversed_coins', 'reversed_recipient_micro', 'reversed_merchant_micro', 'released', 'released_at', 'reconciled_at'] },
  lots: { table: 'coin_lots', order: 'created_at', columns: ['id', 'participant_id', 'source', 'purchase_id', 'order_id', 'buyer_region', 'coins_total', 'coins_remaining', 'coins_refunded', 'coins_debt_repaid', 'earning', 'gross_micro', 'provisional_net_micro', 'provisional_fee_percent', 'settled_charge_micro', 'settled_fee_micro', 'settled_tax_micro', 'settled_refund_micro', 'settled_net_micro', 'settlement_status', 'settlement_batch_id', 'created_at'] },
  settlement: { table: 'play_settlement_lines', order: 'created_at', columns: ['id', 'batch_id', 'order_id', 'product_id', 'transaction_type', 'amount_micro', 'buyer_country', 'transaction_date', 'created_at'] },
  attributions: { table: 'affiliate_attributions', order: 'created_at', columns: ['id', 'order_id', 'partner_id', 'offer_id', 'model', 'funding', 'source', 'gross_micro', 'platform_commission_micro', 'commission_percent', 'commission_micro', 'status', 'status_reason', 'created_at', 'released_at', 'reversed_at'] },
  referral_rewards: { table: 'referral_rewards', order: 'created_at', columns: ['id', 'kind', 'merchant_id', 'referred_participant_id', 'order_id', 'amount_micro', 'status', 'created_at'] },
  payouts: { table: 'payout_requests', order: 'created_at', columns: ['id', 'party_type', 'party_id', 'source', 'amount_micro', 'status', 'external_reference', 'failure_reason', 'decided_by', 'decided_at', 'paid_at', 'created_at'] },
};

const cell = (value) => {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, earningsDb);
  if (!admin) return;
  const spec = EXPORTS[String(req.query.type || '')];
  if (!spec) return res.status(400).json({ error: `type must be one of ${Object.keys(EXPORTS).join(', ')}` });
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 730);
  try {
    let query = earningsDb.from(spec.table).select(spec.columns.join(', ')).order(spec.order, { ascending: false }).limit(50000);
    if (spec.since !== false) query = query.gte('created_at', new Date(Date.now() - days * 86400e3).toISOString());
    const { data, error } = await query;
    if (error) throw error;
    const csv = [spec.columns.join(','), ...(data || []).map((row) => spec.columns.map((c) => cell(row[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="earnings-${req.query.type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error('admin/earnings/export error:', error);
    return res.status(500).json({ error: 'Export failed' });
  }
}
