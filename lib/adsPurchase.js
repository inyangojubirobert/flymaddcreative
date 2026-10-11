// Grants an advertising entitlement for a Google Play purchase - the rules,
// separated from I/O so they can be tested (deps are injected).
//
//   1. Package must be purchasable (billing switched on + Play product id).
//   2. A token already granted is returned as-is to its owner (replay/restore)
//      and refused for anyone else.
//   3. Google's record must say PURCHASED, for this account, quantity 1.
//   4. Insert is protected by the unique (provider, provider_ref) constraint,
//      so a concurrent duplicate resolves to the existing entitlement.
//   5. The purchase is consumed (also acknowledges it) only after the
//      entitlement exists, so a failure never leaves a paid-but-ungranted
//      purchase acknowledged.

import { evaluateProductPurchase, packagePurchasable } from './adsGooglePlay';
import { packageSnapshot } from './ads';

export async function processAdPurchase({ participantId, productId, purchaseToken }, deps) {
  if (!productId || !purchaseToken || purchaseToken.length > 4096) {
    return { status: 400, body: { error: 'A Google Play purchase is required' } };
  }

  const pkg = await deps.findPackageByProduct(productId);
  if (!pkg || !packagePurchasable(pkg)) {
    return { status: 503, body: { error: 'Purchasing this package is not available yet' } };
  }

  const existing = await deps.findEntitlementByToken(purchaseToken);
  if (existing) {
    if (existing.participant_id !== participantId) return { status: 409, body: { error: 'This purchase belongs to another account' } };
    await deps.consume(productId, purchaseToken).catch(() => {});
    return { status: 200, body: { success: true, already_granted: true, entitlement_id: existing.id, status: existing.status } };
  }

  const purchase = await deps.getPurchase(productId, purchaseToken);
  const verdict = evaluateProductPurchase(purchase, participantId);
  if (!verdict.ok) {
    return {
      status: verdict.pending ? 202 : verdict.conflict ? 409 : 400,
      body: { success: false, pending: !!verdict.pending, error: verdict.reason },
    };
  }

  const inserted = await deps.insertEntitlement({
    participant_id: participantId,
    package_id: pkg.id,
    package_snapshot: packageSnapshot(pkg),
    provider: 'google_play',
    provider_ref: purchaseToken,
    order_id: purchase.orderId || null,
    price_usd: pkg.price_usd,
    is_paid: true,
    status: 'available',
  });

  if (inserted.duplicate) {
    const raced = await deps.findEntitlementByToken(purchaseToken);
    if (raced?.participant_id === participantId) {
      return { status: 200, body: { success: true, already_granted: true, entitlement_id: raced.id, status: raced.status } };
    }
    return { status: 409, body: { error: 'This purchase belongs to another account' } };
  }

  const consumption = await deps.consume(productId, purchaseToken);
  return { status: 200, body: { success: true, entitlement_id: inserted.row.id, status: inserted.row.status, consumption } };
}
