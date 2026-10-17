// Applies Google Play refunds / chargebacks / revocations to Dream Coin
// purchases, including quantity-based partial refunds. Each voided entry is
// applied once (dream_coins_reverse_purchase is idempotent per event). If
// the coins were already spent, the balance goes negative - recorded in the
// isolated gifting ledger, which blocks further spending; nothing else is
// touched. Non-coin tokens (ads, digital) are ignored here; their own syncs
// handle them.
// Run from the admin portal, or schedule it (Authorization: Bearer <CRON_SECRET>).
//   POST { days } (default 30, max 30 - Google's voided-purchases window)
//   GET  (Vercel cron, daily - see vercel.json) uses the 30-day window

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { giftsDb, listVoidedCoinPurchases } from '../../../../lib/dreamCoins';
import { reversalForVoided } from '../../../../lib/dreamCoinsRules';

export const config = { maxDuration: 60 };

const REASONS = { 0: 'other', 1: 'remorse', 2: 'not received', 3: 'defective', 4: 'accidental purchase', 5: 'fraud', 6: 'friendly fraud', 7: 'chargeback' };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    if (req.method === 'GET') return res.status(405).json({ error: 'Use POST' });
    const admin = await requireActiveAdmin(req, res, giftsDb);
    if (!admin) return;
  }

  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 30);
  try {
    const voided = await listVoidedCoinPurchases(Date.now() - days * 24 * 60 * 60 * 1000);
    let applied = 0;
    let coins = 0;
    for (const entry of voided) {
      const reversal = reversalForVoided(entry);
      if (!reversal.purchaseToken) continue;
      const { data, error } = await giftsDb.rpc('dream_coins_reverse_purchase', {
        p_purchase_token: reversal.purchaseToken,
        p_quantity: reversal.quantity,
        p_event_key: reversal.eventKey,
        p_reason: `Google Play voided purchase (${REASONS[entry.voidedReason] || 'unknown'}, order ${entry.orderId || 'n/a'})`,
      });
      if (error) throw error;
      if (data > 0) { applied += 1; coins += data; }
    }
    return res.status(200).json({ checked: voided.length, applied, coins_reversed: coins });
  } catch (error) {
    console.error('admin/gifts/sync-voided error:', error.message || error);
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play is not configured' : 'Could not fetch voided purchases' });
  }
}
