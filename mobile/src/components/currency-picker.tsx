import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useCurrencies } from '@/api/marketplace';

// The seller chooses the listing currency. The price they type stays exactly
// as entered; buyers see equivalents, and the currency decides how buyers
// pay and how the seller is paid (explained under the picker).

export function CurrencyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const query = useCurrencies();
  const data = query.data;
  if (!data) return null;
  const selected = data.currencies.find((c) => c.code === value);
  return (
    <View style={styles.box}>
      <ThemedText type="small" themeColor="textSecondary">Listing currency</ThemedText>
      <View style={styles.chips}>
        {data.currencies.map((c) => {
          const allowed = c.code === 'USD' || data.listing_currencies_enabled;
          const on = c.code === value;
          return (
            <Pressable key={c.code} disabled={!allowed} onPress={() => onChange(c.code)}
              style={[styles.chip, on && styles.chipOn, !allowed && styles.chipOff]} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !allowed }}>
              <ThemedText type="smallBold" style={on ? { color: Palette.white } : undefined}>{c.symbol} {c.code}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      {selected ? <ThemedText type="small" themeColor="textSecondary">{selected.explanation}</ThemedText> : null}
      {!data.listing_currencies_enabled ? (
        <ThemedText type="small" themeColor="textSecondary">Listing in naira and other currencies opens soon. For now, list in US dollars.</ThemedText>
      ) : null}
    </View>
  );
}

/**
 * For the listing form: an indicative USD value (search and sorting only) and
 * the payment methods that follow a currency's route once multi-currency
 * checkout is live.
 */
export function useIndicativeUsd() {
  const { data } = useCurrencies();
  return {
    indicativeUsd(amount: number, currency: string): number | null {
      if (currency === 'USD') return amount;
      const rate = Number(data?.rates?.[currency]?.rate);
      return rate > 0 ? Math.round((amount / rate) * 100) / 100 : null;
    },
    paymentMethodsFor(currency: string): ('paystack' | 'usdt')[] {
      if (!data?.listing_currencies_enabled) return ['paystack', 'usdt'];
      const c = data.currencies.find((x) => x.code === currency);
      return c ? [c.checkout_route] : ['paystack', 'usdt'];
    },
  };
}

const styles = StyleSheet.create({
  box: { gap: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Palette.ashSoft },
  chipOn: { backgroundColor: Palette.blue },
  chipOff: { opacity: 0.4 },
});
