// Checkout side of multi-currency listings, used by the protected checkout
// routes once P7 is applied (docs/protected-patches/P7_multicurrency_checkout.diff).
// Not imported by any live route before then.
//
//   * A payment must be created from an open, unexpired quote whose lines
//     are exactly the cart being paid.
//   * Paystack (NGN): the charge is the quote total in kobo, no conversion,
//     and the verified amount must match it exactly.
//   * USDT (USD): the verified transfer must cover the quote total.
//   * Orders keep their legacy USD columns (as USD equivalents, so existing
//     reports and the USD wallet keep working) and get a frozen
//     order_financial_snapshots row holding the real currency figures.

import { currencyDb } from './marketplaceCurrency';
import { QuoteError, sameLines, snapshotRow } from './quoteRules';

export {
  QuoteError, applyQuoteToOrders, paymentMatchesQuote, publicQuote, quoteCheckoutRecord, quoteOrderFields,
  quotePaystackMetadata, sameLines, snapshotRow,
} from './quoteRules';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/**
 * True when a cart must be paid from a quote: listing currencies are on, or
 * (with `lines`) the cart holds a listing priced in another currency. The
 * second case keeps such a listing from ever being charged at its indicative
 * price_usd if the switch is turned off again.
 */
export async function multiCurrencyCheckoutActive(lines) {
  const row = must(await currencyDb.from('currency_settings').select('listing_currencies_enabled').eq('id', true).maybeSingle());
  if (row?.listing_currencies_enabled) return true;
  if (!lines?.length) return false;
  const items = must(await currencyDb.from('catalogue_items').select('id').in('id', lines.map((l) => l.item_id)).neq('listing_currency', 'USD'));
  return (items || []).length > 0;
}

/** Loads a quote for paying: open, the expected route, the same lines, not expired (unless `allowExpired`). */
export async function loadQuoteForPayment(quoteId, { route, lines, allowExpired = false }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(quoteId || ''))) throw new QuoteError('quote_required', 'Refresh the checkout to get a price quote');
  const quote = must(await currencyDb.from('checkout_quotes').select('*').eq('id', quoteId).maybeSingle());
  if (!quote) throw new QuoteError('quote_not_found', 'This price quote no longer exists. Refresh the checkout.');
  if (quote.checkout_route !== route) throw new QuoteError('quote_route_mismatch', 'This checkout uses a different payment method');
  if (lines && !sameLines(quote.lines, lines)) throw new QuoteError('quote_lines_mismatch', 'Your cart changed. Refresh the checkout.');
  if (!allowExpired && new Date(quote.expires_at).getTime() < Date.now()) throw new QuoteError('quote_expired', 'This price quote has expired. Refresh the checkout to get a new one.');
  return quote;
}

/** Binds a payment reference to a quote once (a quote pays for one payment only). */
export async function bindQuotePayment(quoteId, paymentRef) {
  const { data, error } = await currencyDb.from('checkout_quotes').update({ payment_ref: paymentRef })
    .eq('id', quoteId).is('payment_ref', null).select('id').maybeSingle();
  if (error && error.code === '23505') throw new QuoteError('quote_ref_taken', 'This payment reference is already in use');
  if (error) throw error;
  if (!data) {
    const existing = must(await currencyDb.from('checkout_quotes').select('payment_ref').eq('id', quoteId).maybeSingle());
    if (existing?.payment_ref !== paymentRef) throw new QuoteError('quote_already_paid', 'This quote is already being paid. Refresh the checkout.');
  }
}

/** Writes snapshots for orders created from a quote (idempotent) and marks the quote used. */
export async function freezeOrders(quote, orders) {
  const rows = orders.map((order) => {
    const line = quote.lines.find((l) => String(l.item_id) === String(order.item_id));
    if (!line) throw new QuoteError('quote_line_missing', `No quote line for ${order.item_id}`);
    return snapshotRow(order.id, quote, line);
  });
  if (rows.length) must(await currencyDb.from('order_financial_snapshots').upsert(rows, { onConflict: 'order_id', ignoreDuplicates: true }));
  must(await currencyDb.from('checkout_quotes').update({ status: 'used', used_at: new Date().toISOString() }).eq('id', quote.id));
}

/**
 * Freezes the orders of a checkout paid from a quote (found by its payment
 * reference). Does nothing for checkouts without a quote. Safe to repeat, so
 * a retried checkout completes a snapshot an earlier attempt missed.
 */
export async function freezeByPaymentRef(paymentRef, orders) {
  const quote = must(await currencyDb.from('checkout_quotes').select('*').eq('payment_ref', paymentRef).maybeSingle());
  if (quote) await freezeOrders(quote, orders);
  return quote;
}

