// Grants a digital-product licence for a Google Play price-tier purchase.
// Rules separated from I/O (deps injected) so they can be tested.
//
// Binding (a cheaper tier, another item or a reused token can never unlock
// anything):
//   * the product id must be one of our price tiers;
//   * the ITEM is read from Google's own purchase record
//     (obfuscatedExternalProfileId, set by the app at purchase time) - the
//     client's item_id, if sent, must match it;
//   * the BUYER is Google's obfuscatedExternalAccountId and must be the
//     logged-in participant;
//   * purchased, quantity 1, not pending/cancelled;
//   * digital_grant_license() then requires the paid tier >= the item's
//     price, refuses own products / already-owned items, and is idempotent
//     per purchase token (a token is bound to one buyer + one item forever).
// The purchase is consumed only after the licence exists. If granting fails
// the purchase is left unacknowledged, and Google refunds unacknowledged
// purchases automatically after 3 days.

const GRANT_ERRORS = {
  token_already_used: [409, 'This purchase has already been used'],
  product_not_available: [409, 'This product is not available any more. Your payment will be refunded automatically by Google Play.'],
  own_product: [409, 'You cannot buy your own product. Your payment will be refunded automatically by Google Play.'],
  already_owned: [409, 'You already own this. Your payment will be refunded automatically by Google Play.'],
  underpaid: [409, 'The amount paid does not cover this item. Your payment will be refunded automatically by Google Play.'],
  buyer_not_found: [404, 'Account not found'],
};

export async function processDigitalPurchase({ participantId, productId, purchaseToken, itemId }, deps) {
  if (!productId || !purchaseToken || purchaseToken.length > 4096) {
    return { status: 400, body: { error: 'A Google Play purchase is required' } };
  }
  if (deps.paused()) return { status: 503, body: { error: 'Digital purchases are paused right now' } };

  const tier = await deps.findTierByProduct(productId);
  if (!tier || !tier.is_active) return { status: 400, body: { error: 'Unknown price tier' } };

  const existing = await deps.findLicenseByToken(purchaseToken);
  if (existing) {
    if (existing.buyer_id !== participantId) return { status: 409, body: { error: 'This purchase belongs to another account' } };
    await deps.consume(productId, purchaseToken).catch(() => {});
    return { status: 200, body: { success: true, already_granted: true, license_id: existing.id, item_id: existing.item_id } };
  }

  const purchase = await deps.getPurchase(productId, purchaseToken);
  const state = Number(purchase?.purchaseState);
  if (state === 2) return { status: 202, body: { success: false, pending: true, error: 'Payment is pending at Google Play' } };
  if (state !== 0) return { status: 400, body: { error: 'This purchase was cancelled' } };
  if (!purchase.obfuscatedExternalAccountId) return { status: 400, body: { error: 'This purchase is not linked to a One Dream account' } };
  if (purchase.obfuscatedExternalAccountId !== participantId) return { status: 409, body: { error: 'This purchase belongs to another account' } };
  const boundItem = purchase.obfuscatedExternalProfileId;
  if (!boundItem) return { status: 400, body: { error: 'This purchase is not linked to a product' } };
  if (itemId && itemId !== boundItem) return { status: 409, body: { error: 'This purchase was made for a different product' } };
  if (purchase.quantity && Number(purchase.quantity) !== 1) return { status: 400, body: { error: 'Multi-quantity purchases are not supported' } };

  let licenseId;
  try {
    licenseId = await deps.grantLicense({
      buyerId: participantId, itemId: boundItem, paidTierId: tier.id,
      providerRef: purchaseToken, orderId: purchase.orderId || null,
    });
  } catch (error) {
    const key = Object.keys(GRANT_ERRORS).find((code) => String(error?.message || '').includes(code));
    if (!key) throw error;
    const [status, message] = GRANT_ERRORS[key];
    return { status, body: { error: message, code: key } };
  }

  const consumption = await deps.consume(productId, purchaseToken);
  return { status: 200, body: { success: true, license_id: licenseId, item_id: boundItem, consumption } };
}
