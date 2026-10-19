// Shared server-side cart pricing for the multi-listing checkout routes
// (pages/api/catalogue/cart-*.js). Prices always come from catalogue_items,
// never from the client - the client only says which listings and how many.

import { buyerFeePolicy, buyerServiceFeeCents, fromCents, toCents } from './marketplaceFees';
import { DIGITAL_CHECKOUT_MESSAGE, digitalItemIds } from './digitalGuard';

export const MAX_CART_LINES = 20;
export const MAX_LINE_QUANTITY = 99;

/** Validates and de-duplicates [{item_id, quantity}] from a request body. */
export function normalizeCartLines(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Your cart is empty' };
  if (raw.length > MAX_CART_LINES) return { error: `A cart can hold at most ${MAX_CART_LINES} listings` };
  const merged = new Map();
  for (const line of raw) {
    const itemId = typeof line?.item_id === 'string' ? line.item_id.trim() : '';
    const quantity = Number(line?.quantity ?? 1);
    if (!itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      return { error: 'Invalid cart line' };
    }
    merged.set(itemId, Math.min(MAX_LINE_QUANTITY, (merged.get(itemId) || 0) + quantity));
  }
  return { lines: [...merged].map(([item_id, quantity]) => ({ item_id, quantity })) };
}

/**
 * Single-listing checkout (create-payment-intent.js / verify-order.js) charges
 * exactly one unit. Returns why `item` can't be bought that way with
 * `paymentMethod` (when given), or null. Mirrors the cart rules in priceCart.
 */
export function singleItemPurchaseProblem(item, paymentMethod) {
  if (!item || item.status !== 'active') return 'This listing is not available for purchase';
  const price = Number(item.price_usd);
  if (!Number.isFinite(price) || !(toCents(price) > 0)) return 'This listing has no fixed price - message the seller';
  if (item.stock_status === 'out_of_stock') return 'This listing is out of stock';
  if (item.min_order_qty && Number(item.min_order_qty) > 1) {
    return `Minimum order is ${item.min_order_qty} - add it to your cart to choose a quantity`;
  }
  const methods = Array.isArray(item.payment_methods) && item.payment_methods.length ? item.payment_methods : ['paystack', 'usdt'];
  if (paymentMethod && !methods.includes(paymentMethod)) {
    return `This listing does not accept ${paymentMethod === 'usdt' ? 'USDT' : 'card/bank'} payments`;
  }
  return null;
}

/**
 * Prices a cart against live listings. Lines that can't be bought right now
 * are returned with `problem` set and excluded from the totals; callers that
 * take payment must refuse a cart with any problem lines.
 */
export async function priceCart(supabase, lines, rate) {
  const { data, error } = await supabase
    .from('catalogue_items')
    .select('*')
    .in('id', lines.map((line) => line.item_id));
  if (error) throw error;
  const byId = new Map((data || []).map((item) => [String(item.id), item]));
  const digital = await digitalItemIds(supabase, lines.map((line) => line.item_id));

  let subtotalCents = 0;
  let methods = ['paystack', 'usdt'];
  const priced = lines.map((line) => {
    const item = byId.get(line.item_id);
    const unitCents = item ? toCents(item.price_usd) : 0;
    let problem = null;
    if (!item || item.status !== 'active') problem = 'No longer available';
    else if (digital.has(String(item.id))) problem = DIGITAL_CHECKOUT_MESSAGE;
    else if (!(unitCents > 0)) problem = 'No fixed price - message the seller';
    else if (item.stock_status === 'out_of_stock') problem = 'Out of stock';
    else if (item.min_order_qty && line.quantity < item.min_order_qty) problem = `Minimum order is ${item.min_order_qty}`;
    else if (item.max_order_qty && line.quantity > item.max_order_qty) problem = `Maximum order is ${item.max_order_qty}`;

    const lineCents = problem ? 0 : unitCents * line.quantity;
    if (!problem) {
      subtotalCents += lineCents;
      const itemMethods = Array.isArray(item.payment_methods) && item.payment_methods.length ? item.payment_methods : ['paystack', 'usdt'];
      methods = methods.filter((method) => itemMethods.includes(method));
    }
    return {
      item_id: line.item_id,
      quantity: line.quantity,
      title: item?.title || 'Unavailable listing',
      image: item?.images?.[0] || null,
      seller_username: item?.seller_username || null,
      listing_type: item?.listing_type || 'product',
      pricing_model: item?.pricing_model || null,
      price_unit: item?.price_unit || null,
      min_order_qty: item?.min_order_qty || null,
      max_order_qty: item?.max_order_qty || null,
      listing_currency: item?.listing_currency || 'USD',
      unit_price_usd: fromCents(unitCents),
      line_total_usd: fromCents(lineCents),
      problem,
    };
  });

  const policy = await buyerFeePolicy(supabase);
  const feeCents = buyerServiceFeeCents(subtotalCents, policy);
  const totalCents = subtotalCents + feeCents;
  return {
    lines: priced,
    has_problems: priced.some((line) => line.problem),
    payment_methods: methods,
    subtotal_cents: subtotalCents,
    service_fee_cents: feeCents,
    total_cents: totalCents,
    subtotal_usd: fromCents(subtotalCents),
    service_fee_usd: fromCents(feeCents),
    total_usd: fromCents(totalCents),
    exchange_rate: rate,
    // NGN is only the Paystack conversion of the USD total.
    total_ngn: Math.round(fromCents(totalCents) * rate * 100) / 100,
    fee_policy: {
      percent: policy.percent,
      cap_usd: policy.capUsd,
      cap_ngn: policy.capUsd === null ? null : Math.round(policy.capUsd * rate),
    },
  };
}

let readyCache = false;

/**
 * True once supabase/add_cart_checkout.sql has been applied. Checked before
 * any money is taken so a missing migration fails closed (no charge) rather
 * than leaving a paid cart with nowhere to record its orders.
 */
export async function cartCheckoutReady(supabase) {
  if (readyCache) return true;
  const [checkouts, orders, registry, probe] = await Promise.all([
    supabase.from('catalogue_checkouts').select('id').limit(1),
    supabase.from('catalogue_orders').select('checkout_id, quantity, unit_price_usd').limit(1),
    supabase.from('usdt_payments').select('consumed_for, consumed_ref').limit(1),
    // Read-only probe: an unknown tx hash just returns 'not_found'.
    supabase.rpc('claim_usdt_payment', { p_tx_hash: '__readiness_probe__', p_purpose: 'catalogue_cart', p_ref: '__probe__' }),
  ]);
  readyCache = [checkouts, orders, registry, probe].every((result) => !result.error);
  if (!readyCache) {
    console.error('[cart] checkout schema missing - run supabase/add_cart_checkout.sql',
      ...[checkouts, orders, registry, probe].map((result) => result.error?.message).filter(Boolean));
  }
  return readyCache;
}
