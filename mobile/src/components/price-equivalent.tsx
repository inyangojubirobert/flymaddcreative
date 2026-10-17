import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useCurrencies } from '@/api/marketplace';
import type { CatalogueItem } from '@/api/catalogue';
import { approxEquivalent, formatMinor } from '@/lib/money';

// Under a listing's price: an approximate equivalent and how the buyer pays.
// The seller's price is authoritative; the exact charge comes from checkout.

export function PriceEquivalent({ item }: { item: CatalogueItem }) {
  const { data } = useCurrencies();
  const currency = item.listing_currency || 'USD';
  if (!data || currency === 'USD' || !item.listing_price_minor) return null;
  const c = data.currencies.find((x) => x.code === currency);
  if (!c) return null;
  const target = 'USD';
  const approx = approxEquivalent(Number(item.listing_price_minor), currency, target, data.rates, c.minor_units, 2);
  return (
    <View style={{ gap: 2 }}>
      {approx ? <ThemedText type="small" themeColor="textSecondary">≈ {formatMinor(approx, target)} (approximate)</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {c.checkout_route === 'paystack'
          ? 'Paid in naira by card or bank transfer.'
          : `Paid in USDT: the ${currency} price is converted to US dollars once, when you check out.`}
      </ThemedText>
    </View>
  );
}
