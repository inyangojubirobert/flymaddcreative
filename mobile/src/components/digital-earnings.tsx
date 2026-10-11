import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { getDigitalEarnings } from '@/api/digital';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';

// Digital sales ledger (Wallet -> Digital sales). Separate from marketplace
// escrow earnings and vote rewards: Google Play / Paystack pay One Dream, One
// Dream pays sellers after reconciling. Includes paid subscription months.
// Read-only here; payouts are recorded by admins.

const usd = (v: number) => `$${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE = {
  pending: { label: 'On hold', ink: Palette.yellowInk },
  cleared: { label: 'Cleared', ink: Palette.green },
  paid_out: { label: 'Paid out', ink: Palette.blue },
  reversed: { label: 'Refunded', ink: Palette.red },
} as const;

export function DigitalEarningsPanel() {
  const { token } = useAuth();
  const theme = useTheme();
  const query = useQuery({ queryKey: ['digital-earnings'], queryFn: () => getDigitalEarnings(token!), enabled: !!token });
  const d = query.data;

  if (query.isLoading) return <ActivityIndicator style={styles.loading} />;
  if (!d) return <ThemedText themeColor="textSecondary" style={styles.loading}>Couldn&apos;t load digital sales.</ThemedText>;

  return (
    <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
      <View style={[styles.hero, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
        <ThemedText type="small" themeColor="textSecondary">Cleared, awaiting payout</ThemedText>
        <ThemedText type="title" style={styles.amount}>{usd(d.cleared_usd)}</ThemedText>
        <View style={styles.row}>
          <Ionicons name="time" size={15} color={Palette.yellowInk} />
          <ThemedText type="small" style={{ color: Palette.yellowInk }}>{usd(d.pending_usd)} on hold ({d.hold_hours} h refund window)</ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">Paid out so far: {usd(d.paid_out_usd)}</ThemedText>
      </View>

      <View style={styles.grid}>
        <Stat label="Sales" value={String(d.sales)} />
        <Stat label="Gross" value={usd(d.gross_usd)} />
        <Stat label={`Store / card fees (Google ${d.store_fee_percent}%)`} value={`−${usd(d.store_fees_usd)}`} />
        <Stat label={`One Dream commission (${d.commission_percent}%)`} value={`−${usd(d.commission_usd)}`} />
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Buyers pay Google Play (app) or by card (website); One Dream receives the money, and One Dream pays your cleared earnings after reconciling (you get a message with the reference). Refunds are deducted. Prices are in USD; Google&apos;s actual fee and local taxes can differ slightly.
      </ThemedText>

      <ThemedText type="smallBold" style={styles.section}>Recent sales</ThemedText>
      {d.recent.length ? d.recent.map((s) => (
        <View key={s.id} style={[styles.sale, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{usd(s.net_usd)} net{s.source === 'subscription' ? ' · subscription month' : ''}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(s.created_at).toLocaleDateString()} · {usd(s.gross_usd)} − {usd(s.store_fee_usd)} fee − {usd(s.commission_usd)} commission
            </ThemedText>
            {s.reversal_reason ? <ThemedText type="small" style={{ color: Palette.red }}>{s.reversal_reason}</ThemedText> : null}
          </View>
          <ThemedText type="smallBold" style={{ color: STATE[s.state].ink }}>{STATE[s.state].label}</ThemedText>
        </View>
      )) : <ThemedText type="small" themeColor="textSecondary">No digital sales yet. Sell e-books, music or videos from My Listings → Sell as digital.</ThemedText>}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  hero: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: 4 },
  amount: { fontSize: 34, lineHeight: 40, color: Palette.green },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, padding: Spacing.three, gap: 2 },
  section: { marginTop: Spacing.two },
  sale: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
  flex: { flex: 1, gap: 2 },
});
