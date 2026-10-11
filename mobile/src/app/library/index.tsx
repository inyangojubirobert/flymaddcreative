import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAvailablePurchases, useIAP } from 'react-native-iap';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  changeSubscription, getDigitalTiers, getLibrary, subscriptionEntryId, verifyCreatorSubscription, verifyDigitalPurchase,
  type CreatorSubscription, type DigitalKind,
} from '@/api/digital';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';
import { clearPlaybackCache, downloadedEntryIds, purgeInactive } from '@/lib/digital-offline';

const KIND_ICON = { ebook: 'book', audio: 'musical-notes', video: 'film' } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString();

export default function LibraryScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const query = useQuery({ queryKey: ['library'], queryFn: () => getLibrary(token!), enabled: !!token });
  const items = query.data?.items ?? [];
  const subscriptions = query.data?.subscriptions ?? [];
  const subscriptionItems = query.data?.subscription_items ?? [];

  // Online check: wipe offline copies (files + keys) of refunded / revoked items
  // and of items no longer covered by a subscription.
  useEffect(() => {
    clearPlaybackCache();
    if (query.data) {
      void purgeInactive([
        ...query.data.items.filter((i) => i.status === 'active').map((i) => i.license_id),
        ...(query.data.subscription_items ?? []).map((i) => subscriptionEntryId(i.item_id)),
      ]);
    }
  }, [query.data]);

  const downloaded = new Set(downloadedEntryIds());
  const active = items.filter((i) => i.status === 'active');
  const ended = items.filter((i) => i.status !== 'active');
  const nothing = !active.length && !subscriptionItems.length;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'My Library' }} />
      {Platform.OS === 'android' && token ? <PurchaseRecovery /> : null}
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
          {query.isLoading ? <ActivityIndicator style={styles.loading} /> : null}
          {active.map((item) => (
            <LibraryRow key={item.license_id} kind={item.kind} title={item.title} image={item.image}
              subtitle={`@${item.seller_username} · ${day(item.created_at)}`}
              downloaded={downloaded.has(item.license_id)} onPress={() => router.push(`/library/${item.license_id}` as never)} />
          ))}

          {subscriptionItems.length ? <ThemedText type="smallBold" style={styles.gap}>From your subscriptions</ThemedText> : null}
          {subscriptionItems.map((item) => (
            <LibraryRow key={item.item_id} kind={item.kind} title={item.title} image={item.image}
              subtitle={`@${item.seller_username} · included${item.access_until ? ` until ${day(item.access_until)}` : ''}`}
              downloaded={downloaded.has(subscriptionEntryId(item.item_id))} onPress={() => router.push(`/library/${subscriptionEntryId(item.item_id)}` as never)} />
          ))}

          {!query.isLoading && nothing ? (
            <View style={styles.empty}>
              <Ionicons name="library-outline" size={40} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" style={styles.center}>E-books, music and videos you buy or subscribe to appear here, ready to read, listen or watch - even offline.</ThemedText>
            </View>
          ) : null}

          {subscriptions.length ? <ThemedText type="smallBold" style={styles.gap}>Subscriptions</ThemedText> : null}
          {subscriptions.map((s) => <SubscriptionRow key={s.id} sub={s} />)}

          {ended.length ? (
            <>
              <ThemedText type="smallBold" style={styles.gap}>Ended</ThemedText>
              {ended.map((item) => (
                <LibraryRow key={item.license_id} kind={item.kind} title={item.title} image={item.image} inactive
                  subtitle={`${item.status === 'refunded' ? 'Refunded - access removed' : 'Access removed'}${item.revoke_reason ? ` · ${item.revoke_reason}` : ''}`} downloaded={false} />
              ))}
            </>
          ) : null}
          {query.data ? (
            <ThemedText type="small" themeColor="textSecondary">
              Downloads are encrypted, stay inside the One Dream app and work offline for up to {query.data.offline_days} days at a time (subscription items until the paid month ends) - open the Library online to renew. Each purchase or subscription can be used on up to {query.data.max_devices} devices.
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function LibraryRow({ kind, title, image, subtitle, downloaded, inactive, onPress }: { kind: DigitalKind; title: string; image: string | null; subtitle: string; downloaded: boolean; inactive?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }, inactive && styles.inactive]}>
      {image ? <Image source={{ uri: image }} style={styles.cover} /> : (
        <View style={[styles.cover, styles.coverIcon]}><Ionicons name={KIND_ICON[kind] || 'document'} size={22} color={Palette.slate} /></View>
      )}
      <View style={styles.flex}>
        <ThemedText type="smallBold" numberOfLines={2}>{title}</ThemedText>
        <ThemedText type="small" style={inactive ? { color: Palette.red } : undefined} themeColor={inactive ? undefined : 'textSecondary'}>{subtitle}</ThemedText>
      </View>
      {downloaded ? <Ionicons name="cloud-done" size={20} color={Palette.green} /> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} /> : null}
    </Pressable>
  );
}

function SubscriptionRow({ sub }: { sub: CreatorSubscription }) {
  const theme = useTheme();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = !sub.has_access
    ? (sub.status === 'revoked' ? `Ended${sub.end_reason ? ` · ${sub.end_reason}` : ''}` : `Ended ${day(sub.current_period_end)}`)
    : sub.renewal_problem ? `Payment problem: ${sub.renewal_problem}. Access until ${day(sub.current_period_end)}`
      : sub.auto_renew ? `Renews ${day(sub.current_period_end)}` : `Cancelled · access until ${day(sub.current_period_end)}`;

  function change(action: 'cancel' | 'resume') {
    const run = async () => {
      setBusy(true);
      try {
        await changeSubscription(token!, sub.id, action);
        await queryClient.invalidateQueries({ queryKey: ['library'] });
      } catch (error) {
        Alert.alert('Not changed', error instanceof ApiError ? error.message : 'Please try again.');
      } finally {
        setBusy(false);
      }
    };
    if (action === 'resume') return void run();
    Alert.alert('Cancel subscription?', `You keep access until ${day(sub.current_period_end)}. Your card won't be charged again.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel subscription', style: 'destructive', onPress: () => void run() },
    ]);
  }

  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }, !sub.has_access && styles.inactive]}>
      <View style={[styles.cover, styles.coverIcon]}><Ionicons name="star" size={22} color={Palette.lemonInk} /></View>
      <View style={styles.flex}>
        <ThemedText type="smallBold">@{sub.creator_username} · ${sub.price_usd.toFixed(2)}/month</ThemedText>
        <ThemedText type="small" style={sub.renewal_problem ? { color: Palette.red } : undefined} themeColor={sub.renewal_problem ? undefined : 'textSecondary'}>{status}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{sub.provider === 'google_play' ? 'Google Play' : 'Card (website)'}</ThemedText>
      </View>
      {busy ? <ActivityIndicator /> : sub.manage_url && sub.has_access ? (
        <Pressable onPress={() => void Linking.openURL(sub.manage_url!)} style={styles.smallButton}><ThemedText type="smallBold" style={styles.smallButtonText}>Manage</ThemedText></Pressable>
      ) : sub.can_cancel ? (
        <Pressable onPress={() => change('cancel')} style={styles.smallButton}><ThemedText type="smallBold" style={styles.smallButtonText}>Cancel</ThemedText></Pressable>
      ) : sub.can_resume ? (
        <Pressable onPress={() => change('resume')} style={styles.smallButton}><ThemedText type="smallBold" style={styles.smallButtonText}>Resume</ThemedText></Pressable>
      ) : null}
    </View>
  );
}

/** Finishes any digital purchase or creator subscription that was paid but not confirmed (app closed, network lost). */
function PurchaseRecovery() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const ran = useRef(false);
  const { connected, finishTransaction } = useIAP({});
  const tiersQuery = useQuery({ queryKey: ['digital-tiers'], queryFn: getDigitalTiers, staleTime: 300_000 });

  useEffect(() => {
    if (!connected || !token || !tiersQuery.data || ran.current) return;
    ran.current = true;
    const tierIds = new Set(tiersQuery.data.tiers.map((t) => t.google_play_product_id));
    const subIds = new Set(tiersQuery.data.subscription_products ?? []);
    void (async () => {
      const owned = (await getAvailablePurchases().catch(() => [])).filter((p) => (tierIds.has(p.productId) || subIds.has(p.productId)) && p.purchaseToken);
      let recovered = false;
      for (const purchase of owned) {
        try {
          // The server reads the item / creator from Google's purchase record.
          if (subIds.has(purchase.productId)) {
            const result = await verifyCreatorSubscription(token, { productId: purchase.productId, purchaseToken: purchase.purchaseToken! });
            if (result.success) { await finishTransaction({ purchase, isConsumable: false }).catch(() => {}); recovered = true; }
          } else {
            const result = await verifyDigitalPurchase(token, { productId: purchase.productId, purchaseToken: purchase.purchaseToken! });
            if (result.success) { await finishTransaction({ purchase, isConsumable: true }).catch(() => {}); recovered = true; }
          }
        } catch {
          // Leave it: Google refunds purchases we cannot confirm.
        }
      }
      if (recovered) void queryClient.invalidateQueries({ queryKey: ['library'] });
    })();
  }, [connected, token, tiersQuery.data, finishTransaction, queryClient]);

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scroll: { paddingVertical: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  loading: { marginTop: Spacing.six },
  empty: { alignItems: 'center', gap: Spacing.two, marginTop: Spacing.six, paddingHorizontal: Spacing.four },
  center: { textAlign: 'center' },
  gap: { marginTop: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 16, borderWidth: 1, padding: Spacing.two },
  inactive: { opacity: 0.6 },
  cover: { width: 56, height: 56, borderRadius: 10 },
  coverIcon: { backgroundColor: Palette.ashSoft, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  smallButton: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Palette.blueSoft },
  smallButtonText: { color: Palette.blueDark },
});
