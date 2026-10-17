// Pure checkout-quote helpers (no database): how a stored quote becomes the
// legacy order and checkout columns, the frozen snapshot rows, and the
// payment checks. Used by lib/quoteCheckout.js; tested in
// scripts/test-multicurrency.mjs.

/** Same items and quantities, in any order. */
export function sameLines(quoteLines, lines) {
  const key = (ls) => ls.map((l) => `${l.item_id}:${Number(l.quantity)}`).sort().join('|');
  return key(quoteLines) === key(lines);
}

export class QuoteError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const usd2 = (micro) => Math.round(Number(micro) / 10000) / 100;

/**
 * Legacy order columns for one quote line. USD-route lines are exact USD;
 * NGN lines carry USD equivalents for reports only - their real money is in
 * the snapshot, and P8 keeps them out of the USD wallet.
 */
export function quoteOrderFields(quote, line) {
  const charged = BigInt(line.charged_minor);
  const commission = BigInt(line.commission_minor);
  const earnings = BigInt(line.seller_earnings_minor);
  if (quote.checkout_currency === 'USD') {
    return {
      amount_usd: Number(charged) / 100,
      unit_price_usd: Math.round(Number(charged) / line.quantity) / 100,
      commission_percent: line.commission_percent,
      commission_usd: Number(commission) / 100,
      seller_net_usd: Number(earnings) / 100,
      currency: 'USD',
      amount_ngn: null,
    };
  }
  const usdMicro = Number(line.usd_equivalent_micro);
  const commissionUsd = usd2(Number(commission) * usdMicro / Number(charged));
  const amountUsd = usd2(usdMicro);
  return {
    amount_usd: amountUsd,
    unit_price_usd: Math.round(amountUsd * 100 / line.quantity) / 100,
    commission_percent: line.commission_percent,
    commission_usd: commissionUsd,
    seller_net_usd: Math.round((amountUsd - commissionUsd) * 100) / 100,
    currency: 'NGN',
    amount_ngn: Number(charged) / 100,
  };
}

/** The frozen financial record for one order line. */
export function snapshotRow(orderId, quote, line) {
  return {
    order_id: orderId,
    quote_id: quote.id,
    listing_currency: line.listing_currency,
    listing_unit_minor: line.listing_unit_minor,
    quantity: line.quantity,
    listing_line_minor: line.listing_line_minor,
    rate_per_usd: line.rate_per_usd,
    rate_source: line.rate_source,
    rate_published_at: line.rate_published_at,
    checkout_currency: quote.checkout_currency,
    charged_minor: line.charged_minor,
    commission_percent: line.commission_percent,
    commission_minor: line.commission_minor,
    seller_earnings_minor: line.seller_earnings_minor,
    settlement_currency: line.settlement_currency,
    usd_equivalent_micro: line.usd_equivalent_micro,
  };
}

/**
 * Paystack: kobo paid must equal the NGN quote total exactly. USDT: the
 * transfer must cover the USD total, with the same 1 cent tolerance the
 * existing cart check allows.
 */
export function paymentMatchesQuote(quote, { paystackKobo, usdtAmount }) {
  if (quote.checkout_route === 'paystack') return BigInt(Math.round(Number(paystackKobo))) === BigInt(quote.total_minor);
  return Math.round(Number(usdtAmount) * 100) + 1 >= Number(quote.total_minor);
}

/** Order rows built by the existing checkout, with each line's money taken from the quote. */
export function applyQuoteToOrders(rows, quote) {
  const rate = quote.checkout_currency === 'NGN' ? Number(quote.rates?.NGN?.rate) : null;
  return rows.map((row) => {
    const line = quote.lines.find((l) => String(l.item_id) === String(row.item_id));
    if (!line) throw new QuoteError('quote_line_missing', `No quote line for ${row.item_id}`);
    return { ...row, ...quoteOrderFields(quote, line), ...(rate ? { exchange_rate: rate } : {}) };
  });
}

/** Paystack metadata for a quote payment: the quote id plus its USD-equivalent lines for the legacy checkout record. */
export function quotePaystackMetadata(quote) {
  const record = quoteCheckoutRecord(quote);
  return {
    type: 'catalogue_cart',
    quote_id: quote.id,
    checkout_currency: quote.checkout_currency,
    total_minor: String(quote.total_minor),
    lines: record.lines,
    subtotal_usd: record.subtotal_usd,
    service_fee_usd: record.service_fee_usd,
    total_usd: record.total_usd,
    exchange_rate: record.exchange_rate,
  };
}

/**
 * The legacy catalogue_checkouts fields for a quote. USD columns hold exact
 * USD (USDT route) or USD equivalents (NGN route); totals stay cent-exact so
 * total_usd = subtotal_usd + service_fee_usd holds.
 */
export function quoteCheckoutRecord(quote) {
  const lines = quote.lines.map((line) => {
    const f = quoteOrderFields(quote, line);
    return { item_id: line.item_id, quantity: line.quantity, unit_price_usd: f.unit_price_usd, line_total_usd: f.amount_usd };
  });
  const subtotalCents = lines.reduce((n, l) => n + Math.round(l.line_total_usd * 100), 0);
  const ngn = quote.checkout_currency === 'NGN';
  const rate = ngn ? Number(quote.rates?.NGN?.rate) : null;
  if (ngn && !(rate > 0)) throw new QuoteError('quote_rate_missing', 'Quote has no NGN rate');
  const feeCents = ngn ? Math.round(Number(quote.service_fee_minor) / rate) : Number(quote.service_fee_minor);
  return {
    lines,
    subtotal_usd: subtotalCents / 100,
    service_fee_usd: feeCents / 100,
    total_usd: (subtotalCents + feeCents) / 100,
    currency: ngn ? 'NGN' : 'USD',
    amount_ngn: ngn ? Number(quote.total_minor) / 100 : null,
    ...(ngn ? { exchange_rate: rate } : {}),
  };
}

/** What buyers see: what they pay and why. Seller earnings and commission stay server-side. */
export function publicQuote(quote) {
  return {
    id: quote.id,
    checkout_currency: quote.checkout_currency,
    checkout_route: quote.checkout_route,
    subtotal_minor: String(quote.subtotal_minor),
    service_fee_minor: String(quote.service_fee_minor),
    total_minor: String(quote.total_minor),
    expires_at: quote.expires_at,
    lines: quote.lines.map((l) => ({
      item_id: l.item_id, quantity: l.quantity, listing_currency: l.listing_currency,
      listing_line_minor: l.listing_line_minor, charged_minor: l.charged_minor,
      rate_per_usd: l.rate_per_usd, rate_published_at: l.rate_published_at,
    })),
  };
}
