// Marketplace fee policy. Single source of truth for what the buyer is
// charged on top of listing prices - the cart quote, the Paystack charge and
// the order verification all call this, so the amount a buyer sees is the
// amount they pay. See docs/PAYMENTS.md.
//
// Everything is in US dollars (integer cents here, to avoid float drift).
// NGN only appears when a Paystack charge is converted (lib/currency.js).
//
// Settings live in the database (marketplace_fee_settings, single row - see
// supabase/add_marketplace_fee_settings.sql) and are cached for a minute.
// If the table is missing or unreadable, the defaults below apply.

const DEFAULT_POLICY = { percent: 1, capUsd: 1.0, sellerCommissionPercent: 5 };
const CACHE_MS = 60 * 1000;

let cache = { policy: null, at: 0 };

export async function buyerFeePolicy(supabase) {
  if (cache.policy && Date.now() - cache.at < CACHE_MS) return cache.policy;
  let policy = DEFAULT_POLICY;
  try {
    const { data, error } = await supabase
      .from('marketplace_fee_settings')
      .select('buyer_fee_percent, buyer_fee_cap_usd, seller_commission_percent')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      policy = {
        percent: Math.max(0, Number(data.buyer_fee_percent) || 0),
        capUsd: data.buyer_fee_cap_usd === null ? null : Math.max(0, Number(data.buyer_fee_cap_usd) || 0),
        sellerCommissionPercent: Math.max(0, Number(data.seller_commission_percent) || 0),
      };
    }
  } catch (error) {
    console.error('[fees] using default fee policy:', error.message || error);
  }
  cache = { policy, at: Date.now() };
  return policy;
}

/** Buyer service charge for a cart subtotal, in US cents. capUsd null = no cap. */
export function buyerServiceFeeCents(subtotalCents, policy) {
  if (!(subtotalCents > 0) || !(policy.percent > 0)) return 0;
  let fee = Math.round(subtotalCents * policy.percent / 100);
  if (policy.capUsd !== null && policy.capUsd !== undefined) fee = Math.min(fee, toCents(policy.capUsd));
  return Math.max(fee, 0);
}

export const toCents = (usd) => Math.round(Number(usd) * 100);
export const fromCents = (cents) => Math.round(cents) / 100;
