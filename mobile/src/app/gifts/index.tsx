import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CoinStoreProvider, type CoinStore } from '@/components/coin-billing';
import { GiftArt } from '@/components/gift-art';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getCoinPackages, getCoinWallet, getGiftCatalogue, type CoinPackage, type LedgerEntry } from '@/api/gifts';

const LEDGER_LABEL: Record<LedgerEntry['entry_type'], string> = {
  purchase_credit: 'Coins bought',
  purchase_reversal: 'Refund reversed',
  gift_debit: 'Gift sent',
  gift_reversal_credit: 'Gift reversed',
  admin_adjustment: 'Correction',
};

export default function DreamCoinsScreen() {
  const { token, participant } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'sent' | 'activity'>('sent');

  const walletQuery = useQuery({ queryKey: ['coin-wallet'], queryFn: () => getCoinWallet(token!), enabled: !!token });
  const packagesQuery = useQuery({ queryKey: ['coin-packages'], queryFn: getCoinPackages });
  const giftsQuery = useQuery({ queryKey: ['gift-catalogue'], queryFn: getGiftCatalogue });

  const packages = packagesQuery.data?.packages ?? [];
  const billingOn = !!packagesQuery.data?.billing_enabled && packages.some((p) => p.purchasable);
  const wallet = walletQuery.data;
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };

  const refresh = () => {
    void walletQuery.refetch();
    void packagesQuery.refetch();
    void giftsQuery.refetch();
  };

  function storeSection(store: CoinStore | null) {
    if (!billingOn) {
      return <ThemedText type="small" themeColor="textSecondary">Coin packages are coming soon.</ThemedText>;
    }
    if (!store) {
      return <ThemedText type="small" themeColor="textSecondary">Dream Coins can be bought in the One Dream Android app. Coins you own can be sent as gifts here.</ThemedText>;
    }
    return (
      <View style={styles.packageGrid}>
        {packages.map((pkg) => <PackageCard key={pkg.id} pkg={pkg} store={store} />)}
      </View>
    );
  }

  const storeContent = (store: CoinStore | null) => (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={walletQuery.isFetching} onRefresh={refresh} colors={[Palette.blue]} />}
        >
          <View style={[styles.balanceCard]}>
            <ThemedText type="small" style={styles.balanceLabel}>Your Dream Coins</ThemedText>
            {walletQuery.isLoading ? <ActivityIndicator color={Palette.white} /> : (
              <ThemedText style={styles.balance}>🪙 {(wallet?.balance ?? 0).toLocaleString()}</ThemedText>
            )}
            <ThemedText type="small" style={styles.balanceNote}>
              For appreciation gifts only. No cash value - not withdrawable, transferable, or usable for votes or prizes.
            </ThemedText>
            {wallet?.gifting_suspended ? <ThemedText type="smallBold" style={styles.warning}>Gifting is paused on this account. Contact support.</ThemedText> : null}
            {wallet && wallet.balance < 0 ? <ThemedText type="smallBold" style={styles.warning}>A refunded purchase left a negative balance. Gifting resumes once it is back above zero.</ThemedText> : null}
          </View>

          <View style={styles.linkRow}>
            <Pressable onPress={() => participant && router.push(`/gifts/recognition/${participant.username}` as never)} style={[styles.linkCard, card]}>
              <Ionicons name="ribbon" size={20} color={Palette.yellowInk} />
              <ThemedText type="smallBold">My recognition</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/rewards' as never)} style={[styles.linkCard, card]}>
              <Ionicons name="medal" size={20} color={Palette.blue} />
              <ThemedText type="smallBold">Rewards</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="smallBold" style={styles.sectionLabel}>GET DREAM COINS</ThemedText>
          <View style={[styles.section, card]}>{storeSection(store)}</View>

          <ThemedText type="smallBold" style={styles.sectionLabel}>GIFTS</ThemedText>
          <View style={[styles.section, card]}>
            <ThemedText type="small" themeColor="textSecondary">Send one from any seller&apos;s profile, or after a delivered order.</ThemedText>
            <View style={styles.giftGrid}>
              {(giftsQuery.data ?? []).map((gift) => (
                <View key={gift.id} style={styles.giftCell}>
                  <GiftArt gift={gift} size={36} />
                  <ThemedText type="small" numberOfLines={1}>{gift.name}</ThemedText>
                  <ThemedText type="smallBold" style={styles.cost}>🪙 {gift.coin_cost.toLocaleString()}</ThemedText>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.tabs}>
            {(['sent', 'activity'] as const).map((key) => (
              <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
                <ThemedText type="smallBold" style={tab === key ? styles.tabActiveText : undefined}>{key === 'sent' ? 'Gifts sent' : 'Coin activity'}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={[styles.section, card]}>
            {tab === 'sent' ? (
              wallet?.sent.length ? wallet.sent.map((g) => (
                <View key={g.id} style={styles.historyRow}>
                  <GiftArt gift={g.gift_snapshot} size={28} />
                  <View style={styles.historyText}>
                    <ThemedText type="smallBold">{g.quantity > 1 ? `${g.quantity} × ` : ''}{g.gift_snapshot.name} → @{g.recipient?.username ?? '?'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(g.created_at).toLocaleDateString()} · 🪙 {g.coins_spent.toLocaleString()}{g.verified_buyer ? ' · verified purchase' : ''}{g.status === 'reversed' ? ' · reversed' : ''}
                    </ThemedText>
                  </View>
                </View>
              )) : <ThemedText type="small" themeColor="textSecondary">No gifts sent yet.</ThemedText>
            ) : (
              wallet?.ledger.length ? wallet.ledger.map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <View style={styles.historyText}>
                    <ThemedText type="smallBold">{LEDGER_LABEL[entry.entry_type]}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{new Date(entry.created_at).toLocaleString()}{entry.note ? ` · ${entry.note}` : ''}</ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: entry.coins > 0 ? Palette.green : Palette.red }}>
                    {entry.coins > 0 ? '+' : ''}{entry.coins.toLocaleString()}
                  </ThemedText>
                </View>
              )) : <ThemedText type="small" themeColor="textSecondary">No coin activity yet.</ThemedText>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );

  if (Platform.OS !== 'android' || !billingOn) return storeContent(null);
  return (
    <CoinStoreProvider packages={packages} onCredited={() => void queryClient.invalidateQueries({ queryKey: ['coin-wallet'] })}>
      {(store) => storeContent(store)}
    </CoinStoreProvider>
  );
}

function PackageCard({ pkg, store }: { pkg: CoinPackage; store: CoinStore }) {
  const theme = useTheme();
  const price = store.priceFor(pkg);
  const busy = store.busyPackageId === pkg.id;
  const canBuy = !!price && pkg.purchasable && !store.busyPackageId;
  return (
    <Pressable
      onPress={() => canBuy && store.buy(pkg)}
      style={[styles.packageCard, { borderColor: theme.backgroundSelected, opacity: canBuy || busy ? 1 : 0.6 }]}
      accessibilityRole="button"
    >
      {pkg.highlight ? <View style={styles.highlight}><ThemedText type="smallBold" style={styles.highlightText}>{pkg.highlight}</ThemedText></View> : null}
      <ThemedText style={styles.packageCoins}>🪙 {pkg.coins_per_unit.toLocaleString()}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{pkg.name}</ThemedText>
      {busy ? <ActivityIndicator /> : (
        <ThemedText type="smallBold" style={{ color: Palette.blue }}>{price ?? (store.ready ? 'Awaiting Google Play' : 'Connecting…')}</ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  balanceCard: { borderRadius: 20, padding: Spacing.three, gap: Spacing.one, backgroundColor: Palette.blueDark },
  balanceLabel: { color: Palette.blueSoft },
  balance: { color: Palette.white, fontSize: 34, lineHeight: 42, fontWeight: '700' },
  balanceNote: { color: Palette.blueSoft },
  warning: { color: Palette.yellow, marginTop: Spacing.one },
  linkRow: { flexDirection: 'row', gap: Spacing.two },
  linkCard: { flex: 1, borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.one, alignItems: 'flex-start' },
  sectionLabel: { color: Palette.slate, letterSpacing: 0.6, marginBottom: -Spacing.two },
  section: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  packageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  packageCard: { width: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: 2, alignItems: 'center' },
  packageCoins: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  highlight: { position: 'absolute', top: 6, right: 6, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: Palette.lemon },
  highlightText: { color: Palette.lemonInk, fontSize: 10 },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  giftCell: { width: '30%', flexGrow: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.two },
  cost: { color: Palette.yellowInk },
  tabs: { flexDirection: 'row', gap: Spacing.two },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Palette.ashSoft },
  tabActive: { backgroundColor: Palette.blue },
  tabActiveText: { color: Palette.white },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 4 },
  historyText: { flex: 1, gap: 1 },
});
