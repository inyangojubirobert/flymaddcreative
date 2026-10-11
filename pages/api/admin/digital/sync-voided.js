// Applies Google Play refunds / chargebacks to digital licences: the licence
// is revoked (offline copies are wiped at the app's next check) and the
// seller's earning is reversed. One-time product purchases only - AI
// subscriptions and ad packages are unaffected (unknown tokens are ignored).
//   POST { days } (admin) | GET (Vercel cron with CRON_SECRET)

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';
import { listVoidedProductPurchases } from '../../../../lib/adsGooglePlay';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    const admin = await requireActiveAdmin(req, res, digitalDb);
    if (!admin) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  }
  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 30);
  try {
    const voided = await listVoidedProductPurchases(Date.now() - days * 24 * 3600 * 1000);
    let revoked = 0;
    for (const purchase of voided) {
      const { data, error } = await digitalDb.rpc('digital_revoke_license', {
        p_provider: 'google_play', p_provider_ref: purchase.purchaseToken, p_status: 'refunded',
        p_reason: `Google Play voided purchase (order ${purchase.orderId || 'n/a'})`,
      });
      if (error) throw error;
      revoked += data || 0;
    }
    return res.status(200).json({ checked: voided.length, revoked });
  } catch (error) {
    console.error('admin/digital/sync-voided error:', error.message || error);
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play is not configured' : 'Could not fetch voided purchases' });
  }
}
