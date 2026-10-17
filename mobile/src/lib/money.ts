// Money display for multi-currency listings. Amounts are integer minor units
// (kobo, cents, pence) kept as strings/numbers from the server; converted
// equivalents are approximate and for display only - a buyer is charged
// what the checkout quote says.

export const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', NGN: '₦', GBP: '£', EUR: '€', GHS: 'GH₵' };

export function formatMinor(minor: number | string | bigint, currency: string, minorUnits = 2, symbol?: string) {
  const value = Number(minor) / 10 ** minorUnits;
  const s = symbol ?? CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${value < 0 ? '-' : ''}${s}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: minorUnits, maximumFractionDigits: minorUnits })}`;
}

/** "18,000" -> "18000"; returns null when not a positive amount with at most `minorUnits` decimals. */
export function normalizeAmount(text: string, minorUnits = 2): string | null {
  const t = text.replace(/,/g, '').trim();
  const re = minorUnits ? new RegExp(`^\\d+(\\.\\d{1,${minorUnits}})?$`) : /^\d+$/;
  return re.test(t) && Number(t) > 0 ? t : null;
}

/**
 * Approximate equivalent of a listing price in another currency, using the
 * published rates (units of currency per 1 USD). Display only.
 */
export function approxEquivalent(
  minor: number, from: string, to: string, rates: Record<string, { rate: string }>, fromUnits = 2, toUnits = 2,
): number | null {
  if (from === to) return null;
  const perUsd = (code: string) => (code === 'USD' ? 1 : Number(rates[code]?.rate));
  const a = perUsd(from);
  const b = perUsd(to);
  if (!(a > 0) || !(b > 0)) return null;
  const usd = minor / 10 ** fromUnits / a;
  return Math.round(usd * b * 10 ** toUnits);
}
