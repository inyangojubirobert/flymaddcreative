// Multi-currency marketplace maths, with no floating point: every amount is
// an integer number of minor units (kobo, cents, pence) held as BigInt, and
// exchange rates are exact decimal strings. Dependency-free so it runs under
// `node --test` (scripts/test-multicurrency.mjs).
//
// Rules (owner decision, 17 October 2026):
//   * The seller's listing currency and price are authoritative.
//   * NGN listings check out in NGN through Paystack and settle in NGN.
//   * Every other currency checks out in USD (USDT) and settles in USD; the
//     listing price is converted once, in the quote, at a recorded rate.
//   * One checkout is one currency: carts mixing NGN and USD-route listings
//     must be paid as separate checkouts.

export const RATE_DECIMALS = 12;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);
const pow10 = (n) => 10n ** BigInt(n);

/** "1234.5" with 2 minor units -> 123450n. Refuses more decimals than the currency has. */
export function toMinor(amount, minorUnits) {
  const text = String(amount ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (frac.length > minorUnits) return null;
  return BigInt(whole) * pow10(minorUnits) + BigInt((frac + '0'.repeat(minorUnits)).slice(0, minorUnits) || '0');
}

/** 123450n, 2 -> "1234.50" */
export function minorToDecimal(minor, minorUnits) {
  const m = BigInt(minor);
  const sign = m < 0n ? '-' : '';
  const abs = m < 0n ? -m : m;
  if (!minorUnits) return sign + abs.toString();
  const s = abs.toString().padStart(minorUnits + 1, '0');
  return `${sign}${s.slice(0, -minorUnits)}.${s.slice(-minorUnits)}`;
}

export function formatMoney(minor, currency) {
  const n = Number(minorToDecimal(minor, currency.minor_units));
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: currency.minor_units, maximumFractionDigits: currency.minor_units });
  return `${currency.symbol}${formatted}`;
}

/** Exact decimal rate string -> BigInt scaled by 10^12. */
export function parseRate(rate) {
  const text = typeof rate === 'number' ? rate.toFixed(RATE_DECIMALS) : String(rate ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const scaled = BigInt(whole) * RATE_SCALE + BigInt((frac + '0'.repeat(RATE_DECIMALS)).slice(0, RATE_DECIMALS) || '0');
  return scaled > 0n ? scaled : null;
}

/** Integer division rounding half away from zero (for non-negative inputs). */
export function divRoundHalfUp(num, den) {
  if (den <= 0n) throw new Error('division_by_zero');
  return (num * 2n + den) / (den * 2n);
}

/**
 * Converts an amount in a listing currency to USD cents.
 * rate = units of the listing currency per 1 USD (e.g. GBP 0.769230769231).
 */
export function convertToUsdCents(listingMinor, listingMinorUnits, rate) {
  const scaled = parseRate(rate);
  if (!scaled) throw new Error('invalid_rate');
  // usd = (listingMinor / 10^lmu) / rate  ->  cents = listingMinor * 100 * SCALE / (10^lmu * scaledRate)
  return divRoundHalfUp(BigInt(listingMinor) * 100n * RATE_SCALE, pow10(listingMinorUnits) * scaled);
}

/** USD micro (1e-6) equivalent of an amount in any currency, for reporting and USD budgets. */
export function usdMicroEquivalent(minor, minorUnits, rate) {
  if (rate === null || rate === undefined) return BigInt(minor) * pow10(6 - minorUnits); // already USD
  const scaled = parseRate(rate);
  return divRoundHalfUp(BigInt(minor) * pow10(6) * RATE_SCALE, pow10(minorUnits) * scaled);
}

/** Converts a USD cents amount into another currency's minor units (e.g. the $1 fee cap in kobo). */
export function convertUsdCentsTo(usdCents, targetMinorUnits, rate) {
  const scaled = parseRate(rate);
  return divRoundHalfUp(BigInt(usdCents) * pow10(targetMinorUnits) * scaled, 100n * RATE_SCALE);
}

export function percentOf(minor, percent) {
  // percent as a decimal string/number with up to 2 decimals
  const p = toMinor(Number(percent).toFixed(2), 2);
  return divRoundHalfUp(BigInt(minor) * p, 10000n);
}

/** Which checkout a listing currency uses. */
export function routeFor(currency) {
  return { checkout_route: currency.checkout_route, checkout_currency: currency.settlement_currency };
}

/**
 * Groups cart lines by checkout currency. One group = one payment.
 * lines: [{ listing_currency }]; currencies: Map(code -> currency)
 */
export function groupByCheckoutCurrency(lines, currencies) {
  const groups = new Map();
  for (const line of lines) {
    const c = currencies.get(line.listing_currency);
    if (!c) throw new Error(`unknown_currency:${line.listing_currency}`);
    const key = c.settlement_currency;
    if (!groups.has(key)) groups.set(key, { checkout_currency: key, checkout_route: c.checkout_route, lines: [] });
    groups.get(key).lines.push(line);
  }
  return [...groups.values()];
}

/** Rates must be recent and positive. Returns null when fine, else a reason. */
export function rateProblem(rateRow, maxAgeSeconds, now = Date.now()) {
  if (!rateRow) return 'rate_unavailable';
  if (!parseRate(rateRow.rate)) return 'rate_invalid';
  const published = new Date(rateRow.source_published_at).getTime();
  if (!Number.isFinite(published) || now - published > maxAgeSeconds * 1000) return 'rate_stale';
  return null;
}

/** A newly fetched rate that moved more than maxJumpPercent from the last stored one is refused. */
export function rateJumpTooLarge(previousRate, nextRate, maxJumpPercent) {
  if (!previousRate) return false;
  const prev = Number(previousRate);
  const next = Number(nextRate);
  return Math.abs(next - prev) / prev * 100 > Number(maxJumpPercent);
}

/**
 * Builds one checkout quote (a single checkout currency).
 *   lines: [{ item_id, quantity, listing_currency, listing_unit_minor, seller_username }]
 *   currencies: Map(code -> { code, minor_units, settlement_currency, checkout_route })
 *   rates: Map(code -> { rate, source, source_published_at, id })  (not needed for USD)
 *   policy: { commission_percent, buyer_fee_percent, buyer_fee_cap_usd_cents|null }
 * Returns the quote body stored in checkout_quotes, with every amount as a
 * decimal-free integer string.
 */
export function buildQuote({ lines, currencies, rates, policy }) {
  const groups = groupByCheckoutCurrency(lines, currencies);
  if (groups.length !== 1) {
    const err = new Error('mixed_checkout_currencies');
    err.groups = groups.map((g) => ({ checkout_currency: g.checkout_currency, item_ids: g.lines.map((l) => l.item_id) }));
    throw err;
  }
  const group = groups[0];
  const checkoutCurrency = currencies.get(group.checkout_currency);
  const usedRates = {};

  const quoted = group.lines.map((line) => {
    const c = currencies.get(line.listing_currency);
    const quantity = BigInt(line.quantity);
    const listingLine = BigInt(line.listing_unit_minor) * quantity;
    let charged;
    let rate = null;
    if (line.listing_currency === group.checkout_currency) {
      charged = listingLine; // NGN -> NGN, USD -> USD: no conversion
    } else {
      const r = rates.get(line.listing_currency);
      if (!r) throw new Error(`rate_unavailable:${line.listing_currency}`);
      rate = r;
      usedRates[line.listing_currency] = { rate: String(r.rate), source: r.source, published_at: r.source_published_at, id: r.id ?? null };
      charged = convertToUsdCents(listingLine, c.minor_units, r.rate);
      if (charged <= 0n) throw new Error('amount_too_small');
    }
    const commission = percentOf(charged, policy.commission_percent);
    // USD equivalent for reporting: NGN needs the NGN rate; converted lines use their own rate.
    const usdMicro = group.checkout_currency === 'USD'
      ? charged * 10000n
      : usdMicroEquivalent(charged, checkoutCurrency.minor_units, rates.get(group.checkout_currency)?.rate ?? requireRate(rates, group.checkout_currency));
    return {
      item_id: line.item_id,
      seller_username: line.seller_username ?? null,
      quantity: Number(quantity),
      listing_currency: line.listing_currency,
      listing_unit_minor: String(line.listing_unit_minor),
      listing_line_minor: String(listingLine),
      rate_per_usd: rate ? String(rate.rate) : null,
      rate_source: rate ? rate.source : null,
      rate_published_at: rate ? rate.source_published_at : null,
      checkout_currency: group.checkout_currency,
      charged_minor: String(charged),
      commission_percent: Number(policy.commission_percent),
      commission_minor: String(commission),
      seller_earnings_minor: String(charged - commission),
      settlement_currency: group.checkout_currency,
      usd_equivalent_micro: String(usdMicro),
    };
  });

  const subtotal = quoted.reduce((n, l) => n + BigInt(l.charged_minor), 0n);
  let fee = percentOf(subtotal, policy.buyer_fee_percent || 0);
  if (policy.buyer_fee_cap_usd_cents !== null && policy.buyer_fee_cap_usd_cents !== undefined) {
    const cap = group.checkout_currency === 'USD'
      ? BigInt(policy.buyer_fee_cap_usd_cents)
      : convertUsdCentsTo(policy.buyer_fee_cap_usd_cents, checkoutCurrency.minor_units, requireRate(rates, group.checkout_currency));
    if (fee > cap) fee = cap;
  }
  if (group.checkout_currency !== 'USD') usedRates[group.checkout_currency] = rateInfo(rates.get(group.checkout_currency));
  return {
    checkout_currency: group.checkout_currency,
    checkout_route: group.checkout_route,
    lines: quoted,
    subtotal_minor: String(subtotal),
    service_fee_minor: String(fee),
    total_minor: String(subtotal + fee),
    rates: usedRates,
  };
}

function requireRate(rates, code) {
  const r = rates.get(code);
  if (!r) throw new Error(`rate_unavailable:${code}`);
  return r.rate;
}

function rateInfo(r) {
  return r ? { rate: String(r.rate), source: r.source, published_at: r.source_published_at, id: r.id ?? null } : null;
}

/** What a buyer sees next to a listing price: an approximate equivalent, never the charge. */
export function displayEquivalent(listingMinor, from, to, rates) {
  if (from.code === to.code) return null;
  const fromRate = from.code === 'USD' ? '1' : rates.get(from.code)?.rate;
  const toRate = to.code === 'USD' ? '1' : rates.get(to.code)?.rate;
  if (!fromRate || !toRate) return null;
  // listing -> USD -> target
  const usdCents = from.code === 'USD' ? BigInt(listingMinor) : convertToUsdCents(listingMinor, from.minor_units, fromRate);
  return to.code === 'USD' ? usdCents : convertUsdCentsTo(usdCents, to.minor_units, toRate);
}

/** Validates a seller's listing price. */
export function validateListingPrice({ currency, amount }, currencies) {
  const c = currencies.get(String(currency || '').toUpperCase());
  if (!c || !c.is_enabled) return { ok: false, error: 'Choose a supported currency' };
  const minor = toMinor(amount, c.minor_units);
  if (minor === null || minor <= 0n) return { ok: false, error: `Enter a price above 0 with at most ${c.minor_units} decimals` };
  if (minor > 10n ** 15n) return { ok: false, error: 'That price is too large' };
  return { ok: true, currency: c, minor };
}
