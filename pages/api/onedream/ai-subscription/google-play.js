import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../../lib/participantAuth';
import {
  acknowledgeGooglePlaySubscription,
  planFromGoogleProductId,
  syncGooglePlayEntitlement,
  verifyGooglePlaySubscription,
} from '../../../../lib/aiPayments';
import { AI_PLAN_DEFINITIONS } from '../../../../lib/aiFeature';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const purchaseToken = String(req.body?.purchase_token || '').trim();
  const productId = String(req.body?.product_id || '').trim();
  if (!purchaseToken || purchaseToken.length > 4096 || !planFromGoogleProductId(productId)) {
    return res.status(400).json({ error: 'A valid Google Play subscription purchase is required.' });
  }

  try {
    const verified = await verifyGooglePlaySubscription(purchaseToken);
    if (!verified.productIds.includes(productId)) return res.status(400).json({ error: 'Google Play product mismatch.' });
    if (verified.externalAccountId && verified.externalAccountId !== participant.id) {
      return res.status(409).json({ error: 'This Google Play purchase belongs to another FlyMadd account.' });
    }

    const entitlement = await syncGooglePlayEntitlement(supabase, participant.id, purchaseToken, verified);
    if (verified.active && verified.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      await acknowledgeGooglePlaySubscription(verified.productId, purchaseToken);
    }

    const plan = AI_PLAN_DEFINITIONS[entitlement.plan] || AI_PLAN_DEFINITIONS.free;
    return res.status(200).json({
      success: true,
      active: plan.id !== 'free',
      purchaseActive: verified.active,
      status: verified.status,
      plan,
      currentPeriodEnd: entitlement.current_period_end || null,
      pendingProductId: verified.pendingProductId,
      message: verified.pendingProductId && verified.active
        ? `Plan change scheduled. ${plan.name} access continues until ${new Date(verified.currentPeriodEnd).toLocaleDateString('en-GB', { timeZone: 'UTC' })}.`
        : verified.active ? `${plan.name} is now active.` : 'Purchase checked. Your current access has been refreshed.',
    });
  } catch (error) {
    console.error('Google Play AI subscription verification error:', error);
    const migrationMissing = ['42P01', 'PGRST202', 'PGRST205'].includes(error?.code);
    const ownershipError = ['payment_already_claimed', 'payment_account_mismatch'].includes(error?.message);
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(ownershipError ? 409 : migrationMissing || notConfigured ? 503 : 502).json({
      error: ownershipError ? 'This purchase belongs to another FlyMadd account.' : migrationMissing
        ? 'AI payment storage is being set up. Run the AI subscription payment migration.'
        : notConfigured
          ? 'Google Play verification is not configured yet.'
          : 'Unable to verify this Google Play subscription.',
    });
  }
}
