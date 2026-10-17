// Admin: earnings settings and activation gates (audited).
//   PATCH { field: value, ... }
// gift_earnings_enabled, payouts_enabled, seller_funded_settlement_enabled (only
// after P1 is applied) and resale_checkout_enabled (only after P3) are the
// owner-controlled activation switches. Changes apply to new records only:
// every gift, attribution and payout stores the values it was created with.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditEarnings, earningsDb, getEarningsSettings, must } from '../../../../lib/earnings';
import { toMicro } from '../../../../lib/earningsRules';

const BOOLEANS = ['gift_earnings_enabled', 'payouts_enabled', 'seller_funded_settlement_enabled', 'resale_checkout_enabled'];
const PERCENTS = { gift_recipient_percent: [0, 100], gift_merchant_percent: [0, 100], gift_provisional_fee_percent: [0, 100],
  affiliate_max_commission_percent: [0, 90], platform_share_max_percent: [0, 100], seller_referral_percent: [0, 100] };
const INTEGERS = { gift_merchant_months: [0, 120], affiliate_attribution_days: [1, 90], seller_referral_months: [0, 60] };
const MONEY = ['platform_monthly_budget_usd', 'partner_monthly_cap_usd', 'buyer_referral_reward_usd', 'min_payout_usd'];

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, earningsDb);
  if (!admin) return;

  const body = req.body || {};
  const patch = {};
  const errors = [];
  for (const key of BOOLEANS) if (body[key] !== undefined) {
    if (typeof body[key] !== 'boolean') errors.push(`${key}: true/false`); else patch[key] = body[key];
  }
  for (const [key, [min, max]] of Object.entries(PERCENTS)) if (body[key] !== undefined) {
    const v = Number(body[key]);
    if (!(v >= min && v <= max)) errors.push(`${key}: ${min}-${max}`); else patch[key] = v;
  }
  for (const [key, [min, max]] of Object.entries(INTEGERS)) if (body[key] !== undefined) {
    const v = Number(body[key]);
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`${key}: whole number ${min}-${max}`); else patch[key] = v;
  }
  for (const key of MONEY) if (body[key] !== undefined) {
    const column = key.replace(/_usd$/, '_micro');
    if (key === 'partner_monthly_cap_usd' && (body[key] === null || body[key] === '')) { patch[column] = null; continue; }
    const v = Number(body[key]);
    if (!(v >= 0)) errors.push(`${key}: zero or more`); else patch[column] = toMicro(v);
  }
  if (body.gift_value_basis !== undefined) {
    if (!['net', 'gross'].includes(body.gift_value_basis)) errors.push('gift_value_basis: net or gross'); else patch.gift_value_basis = body.gift_value_basis;
  }
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });

  try {
    const before = await getEarningsSettings();
    if ((patch.gift_recipient_percent ?? before.gift_recipient_percent) + (patch.gift_merchant_percent ?? before.gift_merchant_percent) > 100) {
      return res.status(400).json({ error: 'Recipient and merchant shares cannot exceed 100%' });
    }
    const data = must(await earningsDb.from('earnings_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: admin.id })
      .eq('id', true).select('*').single());
    await auditEarnings(admin.id, 'update_settings', 'earnings_settings', 'singleton',
      Object.fromEntries(Object.keys(patch).map((k) => [k, { from: before[k], to: data[k] }])));
    return res.status(200).json({ settings: data });
  } catch (error) {
    console.error('admin/earnings/settings error:', error);
    return res.status(500).json({ error: 'Could not update settings' });
  }
}
