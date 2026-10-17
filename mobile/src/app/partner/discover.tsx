import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';
import { formatMicro, getOffers, joinOffer, type Offer } from '@/api/earnings';

// Offers from sellers: what a sale earns, and how the partner may sell it.

export default function DiscoverOffersScreen() {
  const { token } = useAuth();
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['offers', q], queryFn: () => getOffers(token!, q), enabled: !!token });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <TextInput value={q} onChangeText={setQ} placeholder="Search listings" placeholderTextColor={Palette.slate} style={styles.search} />
        {query.isLoading ? <ActivityIndicator style={{ marginTop: Spacing.five }} /> : (
          <FlatList
            data={query.data?.offers ?? []}
            keyExtractor={(o) => o.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={!query.data?.partner ? (
              <ThemedText type="small" style={styles.warn}>Join the partner programme first to promote these listings.</ThemedText>
            ) : null}
            ListEmptyComponent={<ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>No offers yet.</ThemedText>}
            renderItem={({ item }) => <OfferCard offer={item} days={query.data?.attribution_days ?? 7} canJoin={!!query.data?.partner} />}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function OfferCard({ offer, days, canJoin }: { offer: Offer; days: number; canJoin: boolean }) {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(offer.resale_floor_usd ? String(offer.resale_floor_usd) : '');
  const [busy, setBusy] = useState(false);

  async function join(model: 'referral' | 'storefront' | 'resale') {
    setBusy(true);
    try {
      const r = await joinOffer(token!, { offer_id: offer.id, model, resale_price_usd: model === 'resale' ? Number(price) : undefined });
      Alert.alert(r.status === 'approved' ? 'You are in' : 'Request sent',
        r.status === 'approved' ? 'Create a link or add it to your storefront from "My storefront".' : 'The seller will review your request.');
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    } catch (e) {
      Alert.alert('Not joined', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.row}>
        {offer.item.image ? <Image source={{ uri: offer.item.image }} style={styles.image} /> : <View style={[styles.image, { backgroundColor: Palette.ashSoft }]} />}
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={2}>{offer.item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">@{offer.item.seller_username} · ${offer.item.price_usd.toFixed(2)} · {offer.item.listing_type}</ThemedText>
          <ThemedText type="smallBold" style={{ color: Palette.green }}>
            {offer.funding === 'platform' ? 'Promotion bonus (One Dream pays)' : `${offer.commission_percent}% seller commission`} · about {formatMicro(offer.estimated_commission_micro)} a sale
          </ThemedText>
          {!offer.seller_funded_payable && offer.funding === 'seller' ? (
            <ThemedText type="small" themeColor="textSecondary">Sales are tracked now; seller-funded commission becomes payable when One Dream switches it on.</ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">Sales count for {days} days after a click · {offer.approval === 'auto' ? 'instant approval' : 'seller approves'}</ThemedText>
        </View>
      </View>
      {offer.own_listing ? <ThemedText type="small" themeColor="textSecondary">This is your own listing.</ThemedText>
        : offer.membership ? <ThemedText type="small">Your partnership: {offer.membership.model} · {offer.membership.status}</ThemedText>
        : canJoin ? (
          <View style={styles.actions}>
            {offer.allow_referral ? <Action label="Promote with links" onPress={() => join('referral')} disabled={busy} /> : null}
            {offer.allow_storefront ? <Action label="Add to storefront" onPress={() => join('storefront')} disabled={busy} /> : null}
            {offer.allow_resale ? (
              <View style={styles.resale}>
                <ThemedText type="small" themeColor="textSecondary">
                  Resell from ${offer.resale_floor_usd?.toFixed(2)}{offer.resale_ceiling_usd ? ` to $${offer.resale_ceiling_usd.toFixed(2)}` : ''} · {offer.fulfilment === 'seller' ? 'seller ships' : 'you ship'}
                  {!offer.resale_checkout_live ? ' · reseller pricing goes live soon (sold at the seller\'s price until then)' : ''}
                </ThemedText>
                <View style={styles.row}>
                  <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={styles.priceInput} />
                  <Action label="Resell at this price" onPress={() => join('resale')} disabled={busy} />
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
    </View>
  );
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.5 }]}>
      <ThemedText type="smallBold" style={{ color: Palette.white }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: { margin: Spacing.three, marginBottom: 0, borderWidth: 1, borderColor: Palette.ash, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, backgroundColor: Palette.white },
  list: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  warn: { color: Palette.yellowInk, backgroundColor: Palette.yellowSoft, padding: Spacing.two, borderRadius: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  image: { width: 64, height: 64, borderRadius: 10 },
  flex: { flex: 1, gap: 2 },
  actions: { gap: Spacing.two },
  action: { backgroundColor: Palette.blue, borderRadius: 10, paddingVertical: 9, paddingHorizontal: Spacing.three, alignItems: 'center' },
  resale: { gap: Spacing.one },
  priceInput: { borderWidth: 1, borderColor: Palette.ash, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 8, width: 100, backgroundColor: Palette.white },
});
