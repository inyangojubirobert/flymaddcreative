import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';
import {
  MERCHANT_SOURCES, SOURCE_LABELS, cancelPayout, formatMicro, getEarningsSummary, requestPayout, savePayee,
  type BalanceRow, type EarningsSummary, type Payee,
} from '@/api/earnings';

// Everything a person earns outside their own shop's sales: gifts received,
// gift referrals, affiliate commission, reseller margin and referral rewards.
// Each source has its own balance. Used by /earnings (One Dream account) and
// /merchant/earnings (merchant account).

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', held: 'On hold (dispute)', available: 'Withdrawable', reversed: 'Reversed', excluded: 'Not eligible',
  awaiting_seller_settlement: 'Tracked - seller commission not active yet', awaiting_resale_checkout: 'Tracked - reseller checkout not active yet',
  over_budget: 'Promotion budget reached', over_cap: 'Monthly cap reached',
  requested: 'Requested', approved: 'Approved', paid: 'Paid', failed: 'Failed', rejected: 'Rejected', cancelled: 'Cancelled',
};

export function EarningsView({ token }: { token: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['earnings-summary', token], queryFn: () => getEarningsSummary(token), enabled: !!token });
  const data = query.data;
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['earnings-summary', token] });

  if (query.isLoading) return <ActivityIndicator style={{ marginTop: Spacing.six }} />;
  if (!data) return <ThemedText style={{ margin: Spacing.three }}>{query.error instanceof ApiError ? query.error.message : 'Could not load earnings.'}</ThemedText>;

  const rows: { partyType: 'participant' | 'merchant'; b: BalanceRow }[] = [];
  for (const partyType of ['participant', 'merchant'] as const) {
    for (const b of data.balances[partyType] ?? []) {
      if (partyType === 'participant' && MERCHANT_SOURCES.includes(b.source)) continue;
      if (partyType === 'merchant' && !MERCHANT_SOURCES.includes(b.source)) continue;
      rows.push({ partyType, b });
    }
  }
  const any = rows.some((r) => r.b.pending || r.b.available || r.b.reserved || r.b.paid);

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={refresh} colors={[Palette.blue]} />}>
      {!data.settings.gift_earnings_enabled ? (
        <View style={styles.notice}>
          <ThemedText type="small" style={styles.noticeText}>
            Gift earnings start once One Dream switches them on. Until then, gifts you receive count as recognition only.
          </ThemedText>
        </View>
      ) : null}

      <View style={[styles.section, card]}>
        <ThemedText type="smallBold">Balances</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Pending: waiting for Google Play to pay One Dream (gifts) or for the order to be confirmed (sales). Withdrawable: ready to pay out.
        </ThemedText>
        {rows.filter((r) => any ? (r.b.pending || r.b.available || r.b.reserved || r.b.paid) : true).map((r) => (
          <BalanceLine key={`${r.partyType}-${r.b.source}-${r.b.currency}`} data={data} row={r} token={token} onDone={refresh} />
        ))}
      </View>

      {data.gift_earnings.length ? (
        <View style={[styles.section, card]}>
          <ThemedText type="smallBold">Gifts you received</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            You receive {data.settings.gift_recipient_percent}% of the value of purchased coins spent on your gifts, after Google Play&apos;s fees.
            Amounts are estimates until Google&apos;s monthly report confirms them.
          </ThemedText>
          {data.gift_earnings.map((g) => (
            <Line key={g.id} left={`${g.quantity > 1 ? `${g.quantity} × ` : ''}${g.gift}${g.from ? ` from @${g.from}` : ''}`}
              sub={`${new Date(g.created_at).toLocaleDateString()} · ${g.reconciled ? 'confirmed' : 'estimate'}${g.withdrawable ? ' · withdrawable' : ''}${g.status !== 'active' ? ` · ${g.status.replace('_', ' ')}` : ''}`}
              right={formatMicro(g.recipient_micro)} />
          ))}
        </View>
      ) : null}

      {data.party.merchant_id ? (
        <View style={[styles.section, card]}>
          <ThemedText type="smallBold">Gift referrals ({data.settings.gift_merchant_percent}%)</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            You earn {data.settings.gift_merchant_percent}% of gifts received by people you referred, for {data.settings.gift_merchant_months} months from their registration.
          </ThemedText>
          {data.referred_recipients.map((p) => (
            <Line key={p.username} left={`@${p.username}`} sub={`Registered ${new Date(p.registered_at).toLocaleDateString()}`}
              right={p.active ? `until ${new Date(p.gift_share_until).toLocaleDateString()}` : 'ended'} />
          ))}
          {data.gift_referrals.map((g) => (
            <Line key={g.id} left={`Gift to @${g.recipient}`} sub={`${new Date(g.created_at).toLocaleDateString()}${g.withdrawable ? ' · withdrawable' : ''}`} right={formatMicro(g.merchant_micro)} />
          ))}
          {!data.referred_recipients.length ? <ThemedText type="small" themeColor="textSecondary">Nobody has registered with your referral links yet.</ThemedText> : null}
        </View>
      ) : null}

      {data.attributions.length ? (
        <View style={[styles.section, card]}>
          <ThemedText type="smallBold">Sales you brought in</ThemedText>
          {data.attributions.map((a) => (
            <Line key={a.id} left={a.title || 'Listing'} sub={`${new Date(a.created_at).toLocaleDateString()} · ${a.model} · ${STATUS_LABEL[a.status] || a.status}`}
              right={formatMicro(a.commission_micro, a.currency)} />
          ))}
        </View>
      ) : null}

      {data.referral_rewards.length ? (
        <View style={[styles.section, card]}>
          <ThemedText type="smallBold">Referral rewards</ThemedText>
          {data.referral_rewards.map((r) => (
            <Line key={r.id} left={r.kind === 'seller' ? 'Seller you referred made a sale' : 'Buyer you referred made a first purchase'}
              sub={new Date(r.created_at).toLocaleDateString()} right={formatMicro(r.amount_micro, r.currency)} />
          ))}
        </View>
      ) : null}

      {data.payouts.length ? (
        <View style={[styles.section, card]}>
          <ThemedText type="smallBold">Withdrawals</ThemedText>
          {data.payouts.map((p) => (
            <View key={p.id} style={styles.line}>
              <View style={styles.flex}>
                <ThemedText type="small">{SOURCE_LABELS[p.source]} · {STATUS_LABEL[p.status] || p.status}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(p.created_at).toLocaleDateString()}{p.external_reference ? ` · ref ${p.external_reference}` : ''}{p.failure_reason ? ` · ${p.failure_reason}` : ''}
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{formatMicro(p.amount_micro, p.currency)}</ThemedText>
              {p.status === 'requested' ? (
                <Pressable onPress={() => cancelPayout(token, p.id).then(refresh, (e) => Alert.alert('Not cancelled', e instanceof ApiError ? e.message : 'Try again.'))}>
                  <ThemedText type="small" style={{ color: Palette.red }}>Cancel</ThemedText>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <PayeeForm data={data} token={token} onSaved={refresh} />
    </ScrollView>
  );
}

function BalanceLine({ data, row, token, onDone }: {
  data: EarningsSummary; row: { partyType: 'participant' | 'merchant'; b: BalanceRow }; token: string; onDone: () => void;
}) {
  const currency = row.b.currency;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(Crypto.randomUUID());
  // The minimum is set in USD; the server converts it for naira balances.
  const canWithdraw = data.settings.payouts_open && row.b.available > 0 && (currency !== 'USD' || row.b.available >= data.settings.min_payout_micro);

  async function withdraw() {
    const usd = Number(amount);
    if (!(usd > 0)) return;
    setBusy(true);
    try {
      await requestPayout(token, { source: row.b.source, currency, amount_usd: usd, client_request_id: key.current, as: row.partyType });
      key.current = Crypto.randomUUID();
      setAmount('');
      Alert.alert('Withdrawal requested', 'One Dream will review it and send the transfer to your payout details.');
      onDone();
    } catch (e) {
      Alert.alert('Not requested', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.balance}>
      <ThemedText type="smallBold">{SOURCE_LABELS[row.b.source]}{currency !== 'USD' ? ` · ${currency}` : ''}</ThemedText>
      <View style={styles.bucketRow}>
        <Bucket label="Pending" value={row.b.pending} currency={currency} />
        <Bucket label="Withdrawable" value={row.b.available} currency={currency} strong />
        <Bucket label="In withdrawal" value={row.b.reserved} currency={currency} />
        <Bucket label="Paid" value={row.b.paid} currency={currency} />
      </View>
      {canWithdraw ? (
        <View style={styles.withdrawRow}>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={`Amount (${currency})`} placeholderTextColor={Palette.slate} style={styles.input} />
          <Pressable onPress={withdraw} disabled={busy} style={[styles.button, busy && { opacity: 0.5 }]}>
            <ThemedText type="smallBold" style={{ color: Palette.white }}>Withdraw</ThemedText>
          </Pressable>
        </View>
      ) : row.b.available > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {data.settings.payouts_open ? `Minimum withdrawal is ${formatMicro(data.settings.min_payout_micro)}.` : 'Withdrawals open soon - your balance is safe.'}
        </ThemedText>
      ) : null}
    </View>
  );
}

function Bucket({ label, value, strong, currency }: { label: string; value: number; strong?: boolean; currency: string }) {
  return (
    <View style={styles.bucket}>
      <ThemedText type={strong ? 'smallBold' : 'small'} style={value < 0 ? { color: Palette.red } : undefined}>{formatMicro(value, currency)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.bucketLabel}>{label}</ThemedText>
    </View>
  );
}

function Line({ left, sub, right }: { left: string; sub?: string; right: string }) {
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <ThemedText type="small" numberOfLines={1}>{left}</ThemedText>
        {sub ? <ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText> : null}
      </View>
      <ThemedText type="smallBold">{right}</ThemedText>
    </View>
  );
}

function PayeeForm({ data, token, onSaved }: { data: EarningsSummary; token: string; onSaved: () => void }) {
  const theme = useTheme();
  const partyType = data.party.type;
  const existing = data.payees.find((p) => p.party_type === partyType) || data.payees[0];
  const [form, setForm] = useState<Payee>(existing || { legal_name: '', country: 'NG', date_of_birth: '', payout_method: 'bank_transfer', payout_details: {} });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Payee>) => setForm((f) => ({ ...f, ...patch }));
  const detail = (k: string, v: string) => setForm((f) => ({ ...f, payout_details: { ...f.payout_details, [k]: v } }));

  async function save() {
    setSaving(true);
    try {
      await savePayee(token, { ...form, as: partyType });
      Alert.alert('Saved', 'Your details are waiting for verification.');
      onSaved();
    } catch (e) {
      Alert.alert('Not saved', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder?: string) => (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={Palette.slate}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]} />
    </View>
  );

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">Payout details</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Needed before you can withdraw. You must be 18 or older. Only the last 4 digits of an account are stored here.
        {existing?.kyc_status ? ` Status: ${existing.kyc_status}${existing.kyc_note ? ` - ${existing.kyc_note}` : ''}.` : ''}
      </ThemedText>
      {field('Full legal name', form.legal_name, (v) => set({ legal_name: v }))}
      {field('Country (2 letters)', form.country, (v) => set({ country: v.toUpperCase().slice(0, 2) }), 'NG')}
      {field('Date of birth', form.date_of_birth, (v) => set({ date_of_birth: v }), 'YYYY-MM-DD')}
      {field('Payout method', form.payout_method, (v) => set({ payout_method: v }), 'bank_transfer')}
      {field('Bank / provider', form.payout_details.bank || '', (v) => detail('bank', v))}
      {field('Account (last 4 digits)', form.payout_details.account_last4 || '', (v) => detail('account_last4', v.replace(/\D/g, '').slice(0, 4)))}
      <Pressable onPress={save} disabled={saving} style={[styles.button, saving && { opacity: 0.5 }]}>
        <ThemedText type="smallBold" style={{ color: Palette.white }}>{saving ? 'Saving…' : 'Save payout details'}</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  notice: { borderRadius: 12, padding: Spacing.three, backgroundColor: Palette.yellowSoft },
  noticeText: { color: Palette.yellowInk },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  balance: { gap: Spacing.one, paddingVertical: Spacing.one },
  bucketRow: { flexDirection: 'row', gap: Spacing.two },
  bucket: { flex: 1 },
  bucketLabel: { fontSize: 11 },
  withdrawRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 3 },
  flex: { flex: 1 },
  field: { gap: 2 },
  input: { borderWidth: 1, borderColor: Palette.ash, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 8, flex: 1 },
  button: { backgroundColor: Palette.blue, borderRadius: 10, paddingVertical: 10, paddingHorizontal: Spacing.three, alignItems: 'center' },
});
