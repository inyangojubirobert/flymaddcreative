import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';
import { decideMembership, formatMicro, getSellerMemberships, getSellerOffers, saveSellerOffer, type SellerListing } from '@/api/earnings';

// Seller side of the affiliate marketplace: open your listings to partners,
// choose the commission and resale terms, and approve partner requests.
// The financial impact is shown before anything is published.

export default function SellerPartnersScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const offersQ = useQuery({ queryKey: ['seller-offers'], queryFn: () => getSellerOffers(token!), enabled: !!token });
  const membersQ = useQuery({ queryKey: ['seller-memberships'], queryFn: () => getSellerMemberships(token!), enabled: !!token });
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['seller-offers'] }); void queryClient.invalidateQueries({ queryKey: ['seller-memberships'] }); };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {(membersQ.data?.memberships ?? []).length ? (
            <View style={[styles.section, card]}>
              <ThemedText type="smallBold">Partners</ThemedText>
              {(membersQ.data?.memberships ?? []).map((m) => (
                <View key={m.id} style={styles.row}>
                  <View style={styles.flex}>
                    <ThemedText type="small">@{m.partner.handle} · {m.offer.item.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{m.model}{m.resale_price_usd ? ` at $${Number(m.resale_price_usd).toFixed(2)}` : ''} · {m.status}</ThemedText>
                  </View>
                  {m.status === 'requested' ? (
                    <>
                      <Small label="Approve" onPress={() => decideMembership(token!, m.id, 'approve').then(refresh)} />
                      <Small label="Decline" color={Palette.red} onPress={() => decideMembership(token!, m.id, 'reject').then(refresh)} />
                    </>
                  ) : m.status === 'approved' ? (
                    <Small label="End" color={Palette.red} onPress={() => decideMembership(token!, m.id, 'revoke').then(refresh)} />
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {offersQ.data && !offersQ.data.seller_funded_payable ? (
            <View style={styles.notice}>
              <ThemedText type="small" style={{ color: Palette.yellowInk }}>
                Partner sales are tracked from day one. Commission you fund is only deducted - and paid to partners - once One Dream switches on seller-funded settlement.
              </ThemedText>
            </View>
          ) : null}

          {offersQ.isLoading ? <ActivityIndicator /> : (offersQ.data?.listings ?? []).map((l) => (
            <OfferEditor key={l.item.id} listing={l} platformPercent={offersQ.data!.platform_percent} max={offersQ.data!.max_commission_percent} onSaved={refresh} />
          ))}
          {!offersQ.isLoading && !(offersQ.data?.listings ?? []).length ? (
            <ThemedText themeColor="textSecondary">You have no listings yet.</ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function OfferEditor({ listing, platformPercent, max, onSaved }: { listing: SellerListing; platformPercent: number; max: number; onSaved: () => void }) {
  const { token } = useAuth();
  const theme = useTheme();
  const o = listing.offer;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    allow_referral: o?.allow_referral ?? true,
    allow_storefront: o?.allow_storefront ?? true,
    allow_resale: o?.allow_resale ?? false,
    commission_percent: String(o?.commission_percent ?? 10),
    resale_floor_usd: o?.resale_floor_usd ? String(o.resale_floor_usd) : '',
    resale_ceiling_usd: o?.resale_ceiling_usd ? String(o.resale_ceiling_usd) : '',
    approval: (o?.approval ?? 'auto') as 'auto' | 'manual',
    status: o?.status ?? 'active',
  });
  const [accept, setAccept] = useState(false);
  const pct = Math.max(0, Math.min(max, Number(f.commission_percent) || 0));
  const gross = listing.item.price_usd * 1e6;
  const platform = Math.round(gross * platformPercent / 100);
  const commission = Math.min(Math.floor(gross * pct / 100), gross - platform);
  const live = o && o.status === 'active' && o.seller_accepted_terms_version === o.terms_version;

  async function save() {
    try {
      const r = await saveSellerOffer(token!, {
        item_id: listing.item.id, ...f, commission_percent: pct, funding: 'seller', fulfilment: 'seller', accept_terms: accept,
      });
      Alert.alert('Saved', r.note || 'Your listing is open to partners.');
      setOpen(false);
      setAccept(false);
      onSaved();
    } catch (e) {
      Alert.alert('Not saved', e instanceof ApiError ? e.message : 'Please try again.');
    }
  }

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <Pressable onPress={() => setOpen(!open)} style={styles.row}>
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={1}>{listing.item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ${listing.item.price_usd.toFixed(2)} · {o ? `${live ? 'open to partners' : o.status} · ${o.commission_percent}%${o.funding === 'platform' ? ' (One Dream promotion)' : ''}` : 'not open to partners'}
          </ThemedText>
        </View>
        <ThemedText type="small" style={{ color: Palette.blue }}>{open ? 'Close' : o ? 'Edit' : 'Open to partners'}</ThemedText>
      </Pressable>
      {open ? (
        <>
          <Toggle label="Referral links" value={f.allow_referral} onChange={(v) => setF({ ...f, allow_referral: v })} />
          <Toggle label="Partner storefronts" value={f.allow_storefront} onChange={(v) => setF({ ...f, allow_storefront: v })} />
          <Toggle label="Authorised reselling" value={f.allow_resale} onChange={(v) => setF({ ...f, allow_resale: v })} />
          <Toggle label="Approve each partner myself" value={f.approval === 'manual'} onChange={(v) => setF({ ...f, approval: v ? 'manual' : 'auto' })} />
          <Toggle label="Active" value={f.status === 'active'} onChange={(v) => setF({ ...f, status: v ? 'active' : 'paused' })} />
          <Field label={`Partner commission % (max ${max})`} value={f.commission_percent} onChange={(v) => setF({ ...f, commission_percent: v })} />
          {f.allow_resale ? (
            <>
              <Field label="Lowest resale price you accept ($) - never shown to buyers" value={f.resale_floor_usd} onChange={(v) => setF({ ...f, resale_floor_usd: v })} />
              <Field label="Highest resale price ($, optional)" value={f.resale_ceiling_usd} onChange={(v) => setF({ ...f, resale_ceiling_usd: v })} />
              <ThemedText type="small" themeColor="textSecondary">You ship reseller orders and handle returns as you do today; the buyer sees who sold and who ships.</ThemedText>
            </>
          ) : null}
          <View style={styles.impact}>
            <ThemedText type="small">On a ${listing.item.price_usd.toFixed(2)} sale through a partner:</ThemedText>
            <ThemedText type="small">One Dream commission ({platformPercent}%): {formatMicro(platform)}</ThemedText>
            <ThemedText type="small">Partner commission ({pct}%): {formatMicro(commission)}</ThemedText>
            <ThemedText type="smallBold">You receive: {formatMicro(gross - platform - commission)}</ThemedText>
          </View>
          <Toggle label="I agree to pay this commission on partner sales" value={accept} onChange={setAccept} />
          <Pressable onPress={save} style={[styles.primary, !accept && { opacity: 0.5 }]} disabled={!accept}>
            <ThemedText type="smallBold" style={{ color: Palette.white }}>Save</ThemedText>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" style={styles.flex}>{label}</ThemedText>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={[styles.input, { color: theme.text }]} />
    </View>
  );
}

function Small({ label, onPress, color = Palette.blue }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.small, { backgroundColor: color }]}>
      <ThemedText type="smallBold" style={{ color: Palette.white }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  notice: { borderRadius: 12, padding: Spacing.three, backgroundColor: Palette.yellowSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  input: { borderWidth: 1, borderColor: Palette.ash, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 8 },
  impact: { borderRadius: 10, backgroundColor: Palette.ashSoft, padding: Spacing.two, gap: 2 },
  primary: { backgroundColor: Palette.blue, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  small: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
});
