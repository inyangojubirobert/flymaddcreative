import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useAdmin } from '@/contexts/AdminContext';
import { useTheme } from '@/hooks/use-theme';
import { waitedFor } from '@/lib/admin-shared';

// Withdrawal requests (same rules as the web portal, /api/admin/withdrawals):
// pending -> processing / paid ("claimed") / rejected; processing -> paid / rejected.
// Marking paid needs the payout details, which the participant is sent.

type Withdrawal = {
  id: string;
  username: string;
  amount_usd: number;
  amount_ngn?: number | null;
  currency?: string | null;
  payment_method: string;
  payment_details: string | null;
  status: 'pending' | 'processing' | 'claimed' | 'rejected' | 'paid';
  source: string | null;
  created_at: string;
  admin_note: string | null;
  payout_reference: string | null;
  participant: { id: string; name: string | null; username: string; email: string | null; phone?: string | null; whatsapp?: string | null } | null;
};

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'processing', label: 'Processing' },
  { key: 'claimed', label: 'Paid' },
  { key: 'rejected', label: 'Rejected' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Yes', onPress: () => resolve(true) },
  ]));
}

export default function AdminWithdrawalsScreen() {
  const { adminFetch } = useAdmin();
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<Withdrawal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminFetch<{ withdrawals: Withdrawal[] }>(`/api/admin/withdrawals?status=${filter}&limit=200`);
      setRows(filter === 'pending' ? [...d.withdrawals].reverse() : d.withdrawals); setError(null);
    } catch (e) { setError((e as Error).message || 'Could not load withdrawals'); } finally { setLoading(false); }
  }, [adminFetch, filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Withdrawals' }} />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => { setRows(null); setFilter(f.key); }} style={[styles.chip, filter === f.key && styles.chipOn]}>
            <ThemedText type="smallBold" style={filter === f.key ? styles.chipTextOn : undefined}>{f.label}</ThemedText>
          </Pressable>
        ))}
      </View>
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      {rows === null ? <ActivityIndicator style={styles.loading} color={Palette.blue} /> : (
        <FlatList
          data={rows}
          keyExtractor={(w) => w.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.empty}>No {FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} withdrawals.</ThemedText>}
          renderItem={({ item }) => <WithdrawalCard w={item} onChanged={load} />}
        />
      )}
    </ThemedView>
  );
}

function WithdrawalCard({ w, onChanged }: { w: Withdrawal; onChanged: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const { adminFetch } = useAdmin();
  const [mode, setMode] = useState<null | 'pay' | 'reject'>(null);
  const [payoutType, setPayoutType] = useState<'fiat' | 'crypto'>(/usdt|crypto|bep|trc/i.test(w.payment_method) ? 'crypto' : 'fiat');
  const [currency, setCurrency] = useState(w.currency || (/usdt|crypto/i.test(w.payment_method) ? 'USDT' : 'NGN'));
  const [amount, setAmount] = useState(w.amount_ngn ? String(w.amount_ngn) : String(w.amount_usd));
  const [network, setNetwork] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = [styles.input, { color: theme.text, backgroundColor: theme.background }];
  const canAct = w.status === 'pending' || w.status === 'processing';

  async function patch(body: Record<string, unknown>, question?: [string, string]) {
    if (question && !(await confirm(question[0], question[1]))) return;
    setBusy(true); setError(null);
    try {
      await adminFetch(`/api/admin/withdrawals/${encodeURIComponent(w.id)}`, { method: 'PATCH', body });
      setMode(null);
      onChanged();
    } catch (e) { setError((e as Error).message || 'Could not update'); } finally { setBusy(false); }
  }

  const contact = [w.participant?.whatsapp && `WhatsApp ${w.participant.whatsapp}`, w.participant?.phone && `Phone ${w.participant.phone}`, w.participant?.email].filter(Boolean).join(' · ');

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.cardHead}>
        <ThemedText type="subtitle" style={styles.amount}>${Number(w.amount_usd).toFixed(2)}</ThemedText>
        {w.amount_ngn ? <ThemedText type="small" themeColor="textSecondary">≈ {Number(w.amount_ngn).toLocaleString()} {w.currency || 'NGN'}</ThemedText> : null}
        <ThemedText type="small" style={styles.age}>{waitedFor(w.created_at)} ago</ThemedText>
      </View>
      <ThemedText type="smallBold">@{w.username}{w.participant?.name ? ` · ${w.participant.name}` : ''}</ThemedText>
      {contact ? <ThemedText type="small" themeColor="textSecondary">{contact}</ThemedText> : null}
      <ThemedText type="small">{w.source === 'marketplace' ? 'Marketplace earnings' : 'Vote rewards'} · {w.payment_method}</ThemedText>
      {w.payment_details ? <ThemedText type="small" selectable style={styles.details}>{w.payment_details}</ThemedText> : null}
      {w.admin_note ? <ThemedText type="small" themeColor="textSecondary">Note: {w.admin_note}</ThemedText> : null}
      {w.payout_reference ? <ThemedText type="small" themeColor="textSecondary">Reference: {w.payout_reference}</ThemedText> : null}

      {canAct && !mode ? (
        <View style={styles.actions}>
          {w.status === 'pending' ? <Action label="Processing" color={Palette.blue} busy={busy}
            onPress={() => patch({ status: 'processing' }, ['Mark as processing?', `@${w.username} is told it is being processed.`])} /> : null}
          <Action label="Mark paid" color={Palette.green} onPress={() => setMode('pay')} />
          <Action label="Reject" color={Palette.red} onPress={() => setMode('reject')} />
          {w.participant ? <Action label="Message" color={Palette.slate}
            onPress={() => router.push({ pathname: '/admin/thread', params: { participantId: w.participant!.id } } as never)} /> : null}
        </View>
      ) : null}

      {mode === 'pay' ? (
        <View style={styles.form}>
          <View style={styles.actions}>
            {(['fiat', 'crypto'] as const).map((t) => (
              <Pressable key={t} onPress={() => setPayoutType(t)} style={[styles.chip, payoutType === t && styles.chipOn]}>
                <ThemedText type="smallBold" style={payoutType === t ? styles.chipTextOn : undefined}>{t === 'fiat' ? 'Bank / mobile money' : 'Crypto'}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={styles.pair}>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount paid" placeholderTextColor={theme.textSecondary} style={[input, styles.flex]} />
            <TextInput value={currency} onChangeText={setCurrency} autoCapitalize="characters" placeholder="NGN" placeholderTextColor={theme.textSecondary} style={[input, styles.currency]} />
          </View>
          {payoutType === 'crypto' ? <TextInput value={network} onChangeText={setNetwork} placeholder="Network, e.g. BEP20 or TRC20" placeholderTextColor={theme.textSecondary} style={input} /> : null}
          <TextInput value={reference} onChangeText={setReference} placeholder="Transfer reference / transaction hash" placeholderTextColor={theme.textSecondary} style={input} autoCapitalize="none" />
          <TextInput value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor={theme.textSecondary} style={input} />
          <View style={styles.actions}>
            <Action label="Confirm paid" color={Palette.green} busy={busy} solid onPress={() => patch({
              status: 'claimed', payout_type: payoutType, payout_currency: currency, payout_amount: Number(amount),
              payout_network: payoutType === 'crypto' ? network : undefined, payout_reference: reference, admin_note: note || undefined,
            }, ['Confirm this payout?', `${amount} ${currency} to @${w.username}. They are sent the reference.`])} />
            <Action label="Cancel" color={Palette.slate} onPress={() => setMode(null)} />
          </View>
        </View>
      ) : null}

      {mode === 'reject' ? (
        <View style={styles.form}>
          <TextInput value={note} onChangeText={setNote} placeholder="Reason (the participant sees this)" placeholderTextColor={theme.textSecondary} style={input} multiline />
          <View style={styles.actions}>
            <Action label="Reject request" color={Palette.red} busy={busy} solid onPress={() => patch({ status: 'rejected', admin_note: note || undefined },
              ['Reject this withdrawal?', `@${w.username} is told it was not approved${note ? ' with your reason' : ''}.`])} />
            <Action label="Cancel" color={Palette.slate} onPress={() => setMode(null)} />
          </View>
        </View>
      ) : null}
      {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}
    </View>
  );
}

function Action({ label, color, busy, solid, onPress }: { label: string; color: string; busy?: boolean; solid?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={[styles.action, { borderColor: color }, solid && { backgroundColor: color }]}>
      {busy ? <ActivityIndicator size="small" color={solid ? '#fff' : color} /> : <ThemedText type="smallBold" style={{ color: solid ? '#fff' : color }}>{label}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.two },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: Palette.blue },
  chipOn: { backgroundColor: Palette.blue },
  chipTextOn: { color: '#fff' },
  list: { padding: Spacing.three, paddingTop: 0, gap: Spacing.three },
  card: { borderRadius: 16, padding: Spacing.three, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  amount: { fontSize: 22 },
  age: { marginLeft: 'auto', color: Palette.slate },
  details: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  action: { borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, minWidth: 80, alignItems: 'center' },
  form: { gap: Spacing.two, marginTop: Spacing.two },
  pair: { flexDirection: 'row', gap: Spacing.two },
  input: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: 10, fontSize: 15 },
  currency: { width: 90 },
  loading: { marginTop: 40 },
  empty: { textAlign: 'center', marginTop: 40 },
  error: { color: '#b91c1c', paddingHorizontal: Spacing.one },
});
