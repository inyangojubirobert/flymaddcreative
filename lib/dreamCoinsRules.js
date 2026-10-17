// Dream Coins & virtual gifts - the rules, separated from I/O so they can be
// tested (deps are injected). Dependency-free so it runs under `node --test`.
//
// Purchases (Google Play consumables, multi-quantity aware):
//   1. Billing must be switched on (DREAM_COINS_ENABLED) and the product must
//      be one of our coin packages.
//   2. A token already credited is returned as-is to its owner (replay /
//      restore) and refused for anyone else - never credited twice.
//   3. Google's record must say PURCHASED and be bound to this account. The
//      quantity comes from Google, never from the client.
//   4. Coins = verified quantity x coins_per_unit, credited in one database
//      transaction protected by the unique purchase token.
//   5. The purchase is consumed only after the credit exists, so a failure
//      never leaves a paid-but-uncredited purchase consumed.
//
// Dream Coins have no cash value and nothing here can withdraw, transfer or
// convert them.

export const MAX_PURCHASE_QUANTITY = 1000;
export const MAX_GIFT_QUANTITY = 99;
export const MAX_GIFT_MESSAGE = 140;

/** Checks a Google purchases.products.get response for a coin package. */
export function evaluateCoinPurchase(purchase, participantId) {
  const state = Number(purchase?.purchaseState);
  if (state === 2) return { ok: false, pending: true, reason: 'Payment is pending at Google Play' };
  if (state !== 0) return { ok: false, reason: 'This purchase was cancelled' };
  if (!purchase.obfuscatedExternalAccountId) {
    // The app always binds purchases to the account; an unbound one did not come from it.
    return { ok: false, reason: 'This purchase is not linked to a One Dream account' };
  }
  if (purchase.obfuscatedExternalAccountId !== participantId) {
    return { ok: false, conflict: true, reason: 'This purchase belongs to another account' };
  }
  // Google omits quantity for single-unit purchases.
  const quantity = purchase.quantity === undefined || purchase.quantity === null ? 1 : Number(purchase.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PURCHASE_QUANTITY) {
    return { ok: false, reason: 'Google Play reported an invalid quantity for this purchase' };
  }
  if (purchase.refundableQuantity !== undefined && purchase.refundableQuantity !== null && Number(purchase.refundableQuantity) === 0) {
    return { ok: false, reason: 'This purchase has already been refunded' };
  }
  return { ok: true, quantity, isTest: Number(purchase.purchaseType) === 0 };
}

const purchaseBody = (row, extra = {}) => ({
  success: true,
  purchase_id: row.purchase_id,
  already_credited: !!row.already_credited,
  quantity: row.quantity,
  coins_per_unit: row.coins_per_unit,
  total_coins: row.total_coins,
  balance: row.balance ?? null,
  ...extra,
});

export async function processCoinPurchase({ participantId, productId, purchaseToken }, deps) {
  if (!productId || !purchaseToken || purchaseToken.length > 4096) {
    return { status: 400, body: { error: 'A Google Play purchase is required' } };
  }
  if (!deps.enabled()) {
    return { status: 503, body: { error: 'Dream Coins are not available yet' } };
  }

  const pkg = await deps.findPackageByProduct(productId);
  if (!pkg) return { status: 400, body: { error: 'This is not a Dream Coin package' } };

  const existing = await deps.findPurchaseByToken(purchaseToken);
  if (existing) {
    if (existing.participant_id !== participantId) return { status: 409, body: { error: 'This purchase belongs to another account' } };
    let consumption = existing.consumption_state;
    if (consumption !== 'consumed') consumption = await consumeAndRecord(deps, productId, purchaseToken);
    return {
      status: 200,
      body: purchaseBody({
        purchase_id: existing.id, already_credited: true, quantity: existing.quantity, coins_per_unit: existing.coins_per_unit,
        total_coins: existing.total_coins, balance: await deps.getBalance(participantId),
      }, { consumption }),
    };
  }

  const purchase = await deps.getPurchase(productId, purchaseToken);
  const verdict = evaluateCoinPurchase(purchase, participantId);
  if (!verdict.ok) {
    return {
      status: verdict.pending ? 202 : verdict.conflict ? 409 : 400,
      body: { success: false, pending: !!verdict.pending, error: verdict.reason },
    };
  }

  const credited = await deps.credit({
    participantId,
    packageId: pkg.id,
    productId,
    purchaseToken,
    orderId: purchase.orderId || null,
    quantity: verdict.quantity,
    isTest: verdict.isTest,
    purchasedAt: purchase.purchaseTimeMillis ? new Date(Number(purchase.purchaseTimeMillis)).toISOString() : null,
  });
  if (credited.conflict) return { status: 409, body: { error: 'This purchase belongs to another account' } };

  const consumption = credited.row.consumption_state === 'consumed'
    ? 'consumed'
    : await consumeAndRecord(deps, productId, purchaseToken);
  return { status: 200, body: purchaseBody(credited.row, { consumption }) };
}

async function consumeAndRecord(deps, productId, purchaseToken) {
  const state = await deps.consume(productId, purchaseToken).catch(() => 'failed');
  await deps.recordConsumption(purchaseToken, state).catch(() => {});
  return state;
}

/**
 * One Google voided-purchase entry -> what to reverse. Full refunds reverse
 * whatever is not reversed yet; quantity-based partial refunds (refundType 2)
 * reverse voidedQuantity units. The event key makes each entry apply once.
 */
export function reversalForVoided(voided) {
  const partial = Number(voided?.refundType) === 2 && Number(voided?.voidedQuantity) > 0;
  return {
    purchaseToken: voided?.purchaseToken || '',
    quantity: partial ? Number(voided.voidedQuantity) : null,
    eventKey: `${voided?.voidedTimeMillis || ''}:${voided?.orderId || ''}`,
  };
}

/** Validates a send-gift request body. Prices and balances are never taken from the client. */
export function validateGiftRequest(body) {
  const recipient = String(body?.recipient_username || '').trim().replace(/^@/, '');
  const giftId = String(body?.gift_id || '').trim();
  const quantity = body?.quantity === undefined ? 1 : Number(body.quantity);
  const clientRequestId = String(body?.client_request_id || '');
  const message = body?.message === undefined || body?.message === null ? '' : String(body.message).trim();
  const orderId = body?.order_id ? String(body.order_id) : '';
  const buyerToken = body?.buyer_token ? String(body.buyer_token) : '';

  const errors = [];
  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(recipient)) errors.push('Choose who to send the gift to');
  if (!/^[a-z0-9_]{2,40}$/.test(giftId)) errors.push('Choose a gift');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_GIFT_QUANTITY) errors.push(`Quantity must be 1-${MAX_GIFT_QUANTITY}`);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientRequestId)) errors.push('client_request_id is required');
  if (message.length > MAX_GIFT_MESSAGE) errors.push(`Message must be ${MAX_GIFT_MESSAGE} characters or fewer`);
  if (orderId && (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^[A-Za-z0-9]{8,128}$/.test(buyerToken))) errors.push('Order confirmation details are invalid');
  if (errors.length) return { ok: false, error: errors.join('; ') };
  return {
    ok: true,
    value: {
      recipient, giftId, quantity, clientRequestId, message: message || null,
      anonymous: body?.anonymous === true, orderId: orderId || null, buyerToken: buyerToken || null,
    },
  };
}

/** Delivered orders only: the buyer has confirmed (or funds were already released). */
export function orderAllowsAppreciation(order, { buyerToken, sellerUsername }) {
  if (!order || !buyerToken || order.buyer_token !== buyerToken) return { ok: false, reason: 'Order not found' };
  if (!['buyer_confirmed', 'released'].includes(order.status)) return { ok: false, reason: 'You can thank the seller once you confirm delivery' };
  if (String(order.seller_username || '').toLowerCase() !== String(sellerUsername || '').toLowerCase()) {
    return { ok: false, reason: 'This order is from a different seller' };
  }
  return { ok: true };
}

export const GIFT_ERRORS = {
  self_gifting: [400, 'You cannot send a gift to yourself'],
  invalid_quantity: [400, `Quantity must be 1-${MAX_GIFT_QUANTITY}`],
  insufficient_coins: [402, 'Not enough Dream Coins'],
  account_suspended: [403, 'Gifting is suspended on this account. Contact support.'],
  gift_unavailable: [400, 'This gift is not available'],
  rate_limited: [429, 'You are sending gifts too quickly. Try again later.'],
  daily_limit: [429, 'Daily gifting limit reached. Try again tomorrow.'],
};

/** Maps a raised SQL exception (e.g. "insufficient_coins") to an HTTP reply. */
export function giftErrorReply(message) {
  const key = Object.keys(GIFT_ERRORS).find((k) => String(message || '').includes(k));
  if (!key) return null;
  const [status, error] = GIFT_ERRORS[key];
  return { status, body: { error, code: key } };
}

// Recognition badges from received appreciation. Display only: recognition
// points are not money, a balance or a prize entry.
const BADGES = [
  { id: 'first_thanks', label: 'First thank-you', min_points: 1 },
  { id: 'appreciated', label: 'Appreciated', min_points: 500 },
  { id: 'well_loved', label: 'Well loved', min_points: 2500 },
  { id: 'community_favourite', label: 'Community favourite', min_points: 10000 },
];
export function recognitionBadges(points, supporters) {
  const earned = BADGES.filter((b) => points >= b.min_points).map(({ id, label }) => ({ id, label }));
  if (supporters >= 10) earned.push({ id: 'ten_supporters', label: '10+ supporters' });
  return earned;
}

/**
 * Programme progress from metrics. Metrics a programme names that we cannot
 * measure yet are reported as such (never guessed), and `admin_review`
 * programmes are awarded by the team.
 */
export function evaluateProgram(program, metrics) {
  const criteria = program?.criteria || {};
  const metric = criteria.metric;
  if (!metric || metric === 'admin_review') return { status: 'admin_review', metric: metric || null, value: null, target: null };
  if (!(metric in metrics) || metrics[metric] === null || metrics[metric] === undefined) {
    return { status: 'not_tracked', metric, value: null, target: criteria.threshold ?? null };
  }
  const value = Number(metrics[metric]);
  const target = Number(criteria.threshold ?? 0);
  if (criteria.min_orders && Number(metrics.total_orders || 0) < Number(criteria.min_orders)) {
    return { status: 'in_progress', metric, value, target, note: `Needs at least ${criteria.min_orders} orders` };
  }
  return { status: value >= target ? 'eligible' : 'in_progress', metric, value, target };
}
