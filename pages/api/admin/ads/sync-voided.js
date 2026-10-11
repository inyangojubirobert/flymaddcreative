// Applies Google Play refunds / chargebacks / revocations to advertising
// entitlements: the entitlement is marked refunded and its campaign ends.
// Run from the admin portal, or schedule it (send Authorization: Bearer
// <CRON_SECRET>). Only one-time product purchases are listed, so the AI
// subscription is unaffected.
//   POST { days } (default 30, max 30 - Google's voided-purchases window)
//   GET  (Vercel cron, daily - see vercel.json) uses the 30-day window

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';
import { listVoidedProductPurchases } from '../../../../lib/adsGooglePlay';

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
    return res.status(200).json({ checked: voided.length, revoked });
  } catch (error) {
    console.error('admin/ads/sync-voided error:', error.message || error);
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play is not configured' : 'Could not fetch voided purchases' });
  }
}
