import { useState } from 'react';
import { StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMarketplaceWallet,
  getWalletSummary,
  requestMarketplaceWithdrawal,
  requestWithdrawal,
  type LedgerState,
  type MarketplaceSale,
} from '@/api/wallet';
import { ApiError } from '@/lib/api-client';
import { DigitalEarningsPanel } from '@/components/digital-earnings';

// Two balances, kept separate in accounting and shown side by side:
//   Marketplace earnings - sales after One Dream's commission; withdrawable
//                          only once the buyer confirms delivery.
//   Vote rewards         - $1 per vote received.
// The server recomputes every balance before accepting a withdrawal.

type Tab = 'marketplace' | 'digital' | 'votes';

const usd = (value: number) => `$${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LEDGER_BADGE: Record<LedgerState, { label: string; bg: string; ink: string }> = {
  withdrawable: { label: 'Completed', bg: '#DCFCE7', ink: Palette.green },
  pending: { label: 'Awaiting buyer', bg: Palette.yellowSoft, ink: Palette.yellowInk },
  on_hold: { label: 'Disputed · on hold', bg: Palette.redSoft, ink: Palette.red },
  excluded: { label: 'Not counted', bg: Palette.ashSoft, ink: Palette.slate },
};

const WITHDRAWAL_LABEL: Record<string, string> = {
  pending: 'Pending review',
  processing: 'Processing',
  claimed: 'Paid',
  paid: 'Paid',
  rejected: 'Rejected · returned to balance',
};

export default function WalletScreen() {
  const [tab, setTab] = useState<Tab>('marketplace');
  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Wallet' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.tabs}>
          <TabButton label="Marketplace" icon="storefront" selected={tab === 'marketplace'} onPress={() => setTab('marketplace')} />
          <TabButton label="Digital" icon="library" selected={tab === 'digital'} onPress={() => setTab('digital')} />
          <TabButton label="Votes" icon="trophy" selected={tab === 'votes'} onPress={() => setTab('votes')} />
        </View>
        {tab === 'marketplace' ? <MarketplaceWallet /> : tab === 'digital' ? <DigitalEarningsPanel /> : <VoteWallet />}
      </SafeAreaView>
    </ThemedView>
  );
}

function MarketplaceWallet() {
  const { token } = useAuth();
  const theme = useTheme();
  const query = useQuery({
    queryKey: ['marketplace-wallet'],
    queryFn: () => getMarketplaceWallet(token!),
    enabled: !!token,
  });
  const data = query.data;

  if (query.isLoading) return <ActivityIndicator size="large" style={styles.loading} />;
  if (query.isError || !data) {
    return <ThemedText style={styles.loading} themeColor="textSecondary">Couldn&apos;t load your earnings. Pull to retry.</ThemedText>;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
    >
      <View style={[styles.hero, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
        <ThemedText type="small" themeColor="textSecondary">Withdrawable balance</ThemedText>
        <ThemedText type="title" style={styles.heroAmount}>{usd(data.available_usd)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">From completed sales, after One Dream commission and withdrawals.</ThemedText>
        <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
        <View style={styles.heroRow}>
          <Ionicons name="time" size={16} color={Palette.yellowInk} />
          <ThemedText type="smallBold" style={styles.pendingText}>
            {usd(data.pending_earnings_usd)} awaiting buyer confirmation{data.pending_orders ? ` (${data.pending_orders} order${data.pending_orders === 1 ? '' : 's'})` : ''}
          </ThemedText>
        </View>
        {data.on_hold_usd > 0 ? (
          <View style={styles.heroRow}>
            <Ionicons name="alert-circle" size={16} color={Palette.red} />
            <ThemedText type="smallBold" style={{ color: Palette.red }}>{usd(data.on_hold_usd)} on hold in disputes</ThemedText>
          </View>
        ) : null}
      </View>

      {data.pending_earnings_usd > 0 ? (
        <Notice tone="pending" text="Your buyer has not confirmed delivery yet. These earnings are visible but become withdrawable only once the order is confirmed. Message your buyer from My Orders if you need to follow up." />
      ) : null}
      {data.balance_owed_usd > 0 ? (
        <Notice tone="danger" text={`An order was refunded after it was withdrawn, so ${usd(data.balance_owed_usd)} will be deducted from your next earnings.`} />
      ) : null}

      <View style={styles.grid}>
        <Stat label="Completed sales" value={usd(data.completed_sales_usd)} />
        <Stat label="One Dream commission" value={`−${usd(data.commission_deducted_usd)}`} />
        <Stat label="Withdrawals pending" value={usd(data.withdrawals_pending_usd)} />
        <Stat label="Withdrawn" value={usd(data.withdrawals_paid_usd)} />
      </View>

      <WithdrawForm
        available={data.available_usd}
        queryKey="marketplace-wallet"
        submit={(input) => requestMarketplaceWithdrawal(token!, input)}
        emptyText="Withdrawals open as soon as a buyer confirms delivery of one of your sales."
      />

      <ThemedText type="smallBold" style={styles.sectionTitle}>Sales</ThemedText>
      {data.sales.length ? data.sales.map((sale) => <SaleRow key={sale.order_id} sale={sale} />) : (
        <ThemedText type="small" themeColor="textSecondary">No sales yet. Paid orders appear here with your commission and net earnings.</ThemedText>
      )}
      {data.legacy_orders > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {data.legacy_orders} earlier order{data.legacy_orders === 1 ? ' was' : 's were'} settled before the in-app wallet and {data.legacy_orders === 1 ? 'is' : 'are'} not counted here. Contact support if one is still unpaid.
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionTitle}>Withdrawal history</ThemedText>
      {data.withdrawals.length ? data.withdrawals.map((w) => (
        <View key={w.id} style={[styles.historyRow, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{usd(w.amount_usd)} · {w.payment_method}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(w.created_at).toLocaleDateString()}{w.payout_reference ? ` · Ref ${w.payout_reference}` : ''}{w.admin_note && w.status === 'rejected' ? ` · ${w.admin_note}` : ''}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">{WITHDRAWAL_LABEL[w.status] || w.status}</ThemedText>
        </View>
      )) : <ThemedText type="small" themeColor="textSecondary">No marketplace withdrawals yet.</ThemedText>}
    </ScrollView>
  );
}

function SaleRow({ sale }: { sale: MarketplaceSale }) {
  const theme = useTheme();
  const badge = LEDGER_BADGE[sale.ledger_state];
  return (
    <View style={[styles.sale, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.saleHead}>
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={2}>{sale.title}{sale.quantity > 1 ? ` × ${sale.quantity}` : ''}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Order #{sale.order_id.slice(0, 8)} · {new Date(sale.created_at).toLocaleDateString()}</ThemedText>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <ThemedText type="smallBold" style={[styles.badgeText, { color: badge.ink }]}>{badge.label}</ThemedText>
        </View>
      </View>
      <Line label="Selling price" value={usd(sale.gross_usd)} />
      <Line label={`One Dream commission (${sale.commission_percent}%)`} value={`−${usd(sale.commission_usd)}`} />
      <Line label={sale.ledger_state === 'withdrawable' ? 'Net earnings' : 'Pending net earnings'} value={usd(sale.net_usd)} strong />
      {sale.ledger_state === 'pending' ? (
        <ThemedText type="small" style={styles.pendingText}>Buyer has not confirmed delivery. Visible, but not yet withdrawable.</ThemedText>
      ) : null}
    </View>
  );
}

function VoteWallet() {
  const { token } = useAuth();
  const theme = useTheme();
  const query = useQuery({
    queryKey: ['wallet'],
    queryFn: () => getWalletSummary(token!),
    enabled: !!token,
  });
  const data = query.data;
  if (query.isLoading) return <ActivityIndicator size="large" style={styles.loading} />;

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}
    >
      <View style={[styles.hero, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
        <ThemedText type="small" themeColor="textSecondary">Available vote rewards</ThemedText>
        <ThemedText type="title" style={styles.heroAmountBlue}>{usd(data?.available_balance ?? 0)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Earned {usd(data?.earned ?? 0)} · Withdrawn {usd(data?.withdrawn ?? 0)}</ThemedText>
      </View>

      <WithdrawForm
        available={data?.available_balance ?? 0}
        queryKey="wallet"
        submit={(input) => requestWithdrawal(token!, input)}
        emptyText="You earn $1 for every vote you receive."
      />

      <ThemedText type="smallBold" style={styles.sectionTitle}>Withdrawal history</ThemedText>
      {(data?.withdrawals ?? []).length ? data!.withdrawals.map((item) => (
        <View key={item.id} style={[styles.historyRow, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small">{usd(item.amount_usd)} · {item.payment_method}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{WITHDRAWAL_LABEL[item.status] || item.status}</ThemedText>
        </View>
      )) : <ThemedText type="small" themeColor="textSecondary">No withdrawals yet.</ThemedText>}
    </ScrollView>
  );
}

function WithdrawForm({ available, queryKey, submit, emptyText }: {
  available: number;
  queryKey: string;
  submit: (input: { amount: number; method: string; details: string }) => Promise<unknown>;
  emptyText: string;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    const amountNum = Math.round(parseFloat(amount) * 100) / 100;
    if (!amountNum || amountNum <= 0) return setError('Enter a valid amount.');
    if (amountNum > available) return setError(`The most you can withdraw is ${usd(available)}.`);
    if (!method.trim() || !details.trim()) return setError('Enter a payout method and account or wallet details.');
    setIsSubmitting(true);
    try {
      await submit({ amount: amountNum, method: method.trim(), details: details.trim() });
      setMessage('Request sent. The amount is reserved while One Dream reviews it - you will get a message when it is paid.');
      setAmount('');
      setDetails('');
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!(available > 0)) {
    return (
      <View style={[styles.form, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">Request a withdrawal</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{message || emptyText}</ThemedText>
      </View>
    );
  }

  const input = [styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }];
  return (
    <View style={[styles.form, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">Request a withdrawal · up to {usd(available)}</ThemedText>
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      {message ? <ThemedText style={styles.success}>{message}</ThemedText> : null}
      <TextInput placeholder="Amount (USD)" placeholderTextColor={theme.textSecondary} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={input} />
      <TextInput placeholder="Payout method (e.g. Bank transfer, USDT)" placeholderTextColor={theme.textSecondary} value={method} onChangeText={setMethod} style={input} />
      <TextInput placeholder="Account / wallet details" placeholderTextColor={theme.textSecondary} value={details} onChangeText={setDetails} multiline style={[input, styles.textArea]} />
      <Pressable onPress={handleSubmit} disabled={isSubmitting} style={[styles.submitButton, isSubmitting && styles.disabled]}>
        {isSubmitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.submitButtonText}>Send withdrawal request</ThemedText>}
      </Pressable>
    </View>
  );
}

function TabButton({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, selected && styles.tabSelected]} accessibilityRole="tab" accessibilityState={{ selected }}>
      <Ionicons name={icon} size={15} color={selected ? Palette.white : Palette.blueDark} />
      <ThemedText type="smallBold" style={{ color: selected ? Palette.white : Palette.blueDark }}>{label}</ThemedText>
    </Pressable>
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

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <ThemedText type={strong ? 'smallBold' : 'small'} themeColor={strong ? undefined : 'textSecondary'} style={styles.flex}>{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

function Notice({ tone, text }: { tone: 'pending' | 'danger'; text: string }) {
  return (
    <View style={[styles.notice, tone === 'pending' ? styles.noticePending : styles.noticeDanger]}>
      <Ionicons name={tone === 'pending' ? 'information-circle' : 'alert-circle'} size={18} color={tone === 'pending' ? Palette.yellowInk : Palette.red} />
      <ThemedText type="small" style={[styles.flex, { color: tone === 'pending' ? Palette.yellowInk : Palette.red }]}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  flex: { flex: 1 },
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.three },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingVertical: 10, backgroundColor: Palette.blueSoft },
  tabSelected: { backgroundColor: Palette.blue },
  scrollContent: { paddingBottom: Spacing.five, gap: Spacing.three, paddingTop: Spacing.three },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  hero: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: 4 },
  heroAmount: { fontSize: 34, lineHeight: 40, color: Palette.green },
  heroAmountBlue: { fontSize: 34, lineHeight: 40, color: Palette.blue },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  divider: { height: 1, marginVertical: Spacing.two },
  pendingText: { color: Palette.yellowInk },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, padding: Spacing.three, gap: 2 },
  notice: { flexDirection: 'row', gap: Spacing.two, borderRadius: 14, padding: Spacing.three },
  noticePending: { backgroundColor: Palette.yellowSoft },
  noticeDanger: { backgroundColor: Palette.redSoft },
  sectionTitle: { marginTop: Spacing.two },
  sale: { borderRadius: 16, borderWidth: 1, padding: Spacing.three, gap: 6 },
  saleHead: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', marginBottom: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 11 },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  form: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14 },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  submitButton: { backgroundColor: Palette.green, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
  error: { color: Palette.red },
  success: { color: Palette.green },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
});
