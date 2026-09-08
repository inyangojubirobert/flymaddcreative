import { FlatList, StyleSheet, Pressable, ActivityIndicator, Alert, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getMyOrders, orderAction, type CatalogueOrder } from '@/api/catalogue';
import { ApiError } from '@/lib/api-client';

const STATUS_LABEL: Record<CatalogueOrder['status'], string> = {
  paid: '💰 Paid – Awaiting Delivery',
  pending_verification: '🔍 USDT Verifying',
  buyer_confirmed: '✅ Buyer Confirmed',
  disputed: '⚠️ Disputed',
  released: '🟢 Released',
};

export default function MyOrdersScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => getMyOrders(token!),
    enabled: !!token,
  });

  async function releaseFunds(order: CatalogueOrder) {
    if (!token) return;
    Alert.alert('Release funds?', 'This confirms the buyer has received their order and cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Release',
        onPress: async () => {
          try {
            await orderAction({ order_id: order.id, action: 'release_funds', token });
            queryClient.invalidateQueries({ queryKey: ['my-orders'] });
          } catch (e) {
            Alert.alert('Failed', e instanceof ApiError ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'My Orders' }} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.introCard}>
          <View style={styles.introIcon}><Ionicons name="receipt" size={23} color={Palette.blue} /></View>
          <View style={styles.introCopy}>
            <ThemedText type="smallBold" style={styles.introTitle}>Customer orders and payments</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Track paid, verifying, delivered, disputed, and released product orders.</ThemedText>
          </View>
        </View>
        {ordersQuery.isLoading ? (
          <ActivityIndicator size="large" style={styles.loading} />
        ) : (
          <FlatList<CatalogueOrder>
            data={ordersQuery.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={ordersQuery.isFetching} onRefresh={() => void ordersQuery.refetch()} colors={[Palette.blue]} />}
            ListEmptyComponent={<ThemedText style={styles.empty} themeColor="textSecondary">No orders yet.</ThemedText>}
            renderItem={({ item }) => (
              <ThemedView style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                <View style={styles.cardHeading}>
                  <View style={styles.cardTitleWrap}>
                    <ThemedText type="smallBold" numberOfLines={1}>{item.catalogue_items?.title ?? 'Item'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Order #{item.id.slice(0, 8)} · {new Date(item.created_at).toLocaleDateString()}</ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={styles.amount}>${Number(item.amount_usd).toFixed(2)}</ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="person" size={15} color={Palette.slate} />
                  <ThemedText type="small" themeColor="textSecondary">{item.buyer_name}</ThemedText>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name={item.payment_method === 'paystack' ? 'card' : 'diamond'} size={15} color={Palette.slate} />
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.payment_method === 'paystack' ? 'Paystack payment' : `USDT payment · ${item.network?.toUpperCase() || 'crypto'}`}
                    {item.payment_ref ? ` · ${item.payment_ref.slice(-10)}` : item.tx_hash ? ` · ${item.tx_hash.slice(-10)}` : ''}
                  </ThemedText>
                </View>
                <View style={styles.statusBadge}><ThemedText type="smallBold" style={styles.statusText}>{STATUS_LABEL[item.status]}</ThemedText></View>
                <Pressable
                  onPress={() => router.push({ pathname: '/catalogue/order-chat', params: { orderId: item.id, title: item.catalogue_items?.title ?? 'Item' } })}
                  style={styles.messageButton}
                >
                  <Ionicons name="chatbubble" size={16} color="#fff" />
                  <ThemedText style={styles.messageButtonText}>Message buyer</ThemedText>
                </Pressable>
                {item.status === 'buyer_confirmed' && (
                  <Pressable onPress={() => releaseFunds(item)} style={styles.releaseButton}>
                    <Ionicons name="checkmark-circle" size={17} color="#fff" />
                    <ThemedText style={styles.releaseButtonText}>Release funds to me</ThemedText>
                  </Pressable>
                )}
              </ThemedView>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  introCard: { marginTop: Spacing.two, padding: 12, borderRadius: 17, backgroundColor: Palette.blueSoft, borderWidth: 1, borderColor: '#BFDBFE', flexDirection: 'row', alignItems: 'center', gap: 11 },
  introIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1, gap: 2 },
  introTitle: { color: Palette.blueDark },
  loading: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingVertical: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  card: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  cardTitleWrap: { flex: 1, gap: 2 },
  amount: { color: Palette.blueDark },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#ECFCCB' },
  statusText: { color: '#3F6212', fontSize: 11 },
  releaseButton: { backgroundColor: '#15803d', borderRadius: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, marginTop: Spacing.two },
  releaseButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  messageButton: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, marginTop: Spacing.one },
  messageButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
