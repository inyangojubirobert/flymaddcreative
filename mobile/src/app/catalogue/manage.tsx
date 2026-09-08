import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { getCatalogueByUsername, getMyOrders, type CatalogueOrder } from '@/api/catalogue';

const ORDER_LABEL: Record<CatalogueOrder['status'], string> = {
  paid: 'Paid · awaiting delivery',
  pending_verification: 'Payment verifying',
  buyer_confirmed: 'Buyer confirmed',
  disputed: 'Disputed',
  released: 'Funds released',
};

export default function ManageShopScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { participant, token } = useAuth();
  const username = participant?.username;

  const productsQuery = useQuery({
    queryKey: ['my-catalogue', username],
    queryFn: () => getCatalogueByUsername(username!),
    enabled: !!username,
  });
  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => getMyOrders(token!),
    enabled: !!token,
  });

  const products = productsQuery.data ?? [];
  const orders = ordersQuery.data ?? [];
  const activeProducts = products.filter((item) => item.status === 'active').length;
  const paidRevenue = orders
    .filter((order) => ['paid', 'buyer_confirmed', 'released'].includes(order.status))
    .reduce((sum, order) => sum + Number(order.amount_usd || 0), 0);
  const refreshing = productsQuery.isFetching || ordersQuery.isFetching;

  function refresh() {
    void productsQuery.refetch();
    void ordersQuery.refetch();
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'My Shop' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[Palette.green]} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.storeIcon}><Ionicons name="storefront" size={28} color="#3F6212" /></View>
            <View style={styles.heroCopy}>
              <ThemedText type="title" style={styles.heroTitle}>{products.length ? 'Your shop is ready' : 'Create your shop'}</ThemedText>
              <ThemedText type="small" style={styles.heroText}>
                {products.length ? `@${username} · ${activeProducts} live product${activeProducts === 1 ? '' : 's'}` : 'Add your first product to publish your FlyMadd storefront.'}
              </ThemedText>
            </View>
          </View>

          <View style={styles.heroActions}>
            <Pressable onPress={() => router.push('/catalogue/my-listings' as never)} style={styles.primaryButton}>
              <Ionicons name="add-circle" size={19} color="#1F2937" />
              <ThemedText style={styles.primaryButtonText}>{products.length ? 'Add or edit products' : 'Create first product'}</ThemedText>
            </Pressable>
            {products.length > 0 ? (
              <Pressable onPress={() => router.push(`/catalogue/${username}` as never)} style={styles.outlineButton}>
                <Ionicons name="eye" size={18} color={Palette.blueDark} />
                <ThemedText style={styles.outlineButtonText}>View public shop</ThemedText>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.metricsRow}>
            <Metric icon="pricetags" label="Products" value={String(products.length)} tint={Palette.blueSoft} ink={Palette.blueDark} />
            <Metric icon="bag-check" label="Orders" value={String(orders.length)} tint={Palette.yellowSoft} ink={Palette.yellowInk} />
            <Metric icon="cash" label="Paid sales" value={`$${paidRevenue.toFixed(2)}`} tint="#DCFCE7" ink={Palette.green} />
          </View>

          <SectionHeading icon="grid" title="Catalogue" action="Manage listings" onPress={() => router.push('/catalogue/my-listings' as never)} />
          {productsQuery.isLoading ? <ActivityIndicator color={Palette.blue} /> : products.length ? (
            <View style={styles.cardList}>
              {products.slice(0, 4).map((item) => (
                <Pressable key={item.id} onPress={() => router.push(`/catalogue/item/${item.id}` as never)} style={[styles.productCard, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                  {item.images?.[0] ? <Image source={{ uri: item.images[0] }} style={styles.productImage} /> : (
                    <View style={[styles.productImage, styles.productPlaceholder]}><Ionicons name="image" size={24} color={Palette.slate} /></View>
                  )}
                  <View style={styles.productCopy}>
                    <ThemedText type="smallBold" numberOfLines={1}>{item.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.size ? `Size: ${item.size}` : item.description || 'No description'}</ThemedText>
                    <ThemedText type="smallBold" style={styles.price}>${Number(item.price_usd).toFixed(2)} · {item.status === 'active' ? 'Live' : 'Paused'}</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="storefront-outline" size={32} color={Palette.slate} />
              <ThemedText type="smallBold">No products listed yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>Your public shop appears as soon as you publish the first item.</ThemedText>
            </View>
          )}

          <SectionHeading icon="receipt" title="Orders & payments" action="View all" onPress={() => router.push('/catalogue/my-orders' as never)} />
          {ordersQuery.isLoading ? <ActivityIndicator color={Palette.blue} /> : orders.length ? (
            <View style={styles.cardList}>
              {orders.slice(0, 4).map((order) => (
                <Pressable key={order.id} onPress={() => router.push({ pathname: '/catalogue/order-chat', params: { orderId: order.id, title: order.catalogue_items?.title ?? 'Item' } })} style={[styles.orderCard, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                  <View style={styles.orderIcon}><Ionicons name={order.payment_method === 'paystack' ? 'card' : 'diamond'} size={19} color={Palette.blue} /></View>
                  <View style={styles.orderCopy}>
                    <ThemedText type="smallBold" numberOfLines={1}>{order.catalogue_items?.title ?? 'Product order'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{order.buyer_name} · {order.payment_method === 'paystack' ? 'Paystack' : `USDT ${order.network?.toUpperCase() || ''}`}</ThemedText>
                    <ThemedText type="small" style={styles.orderStatus}>{ORDER_LABEL[order.status]}</ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={styles.orderAmount}>${Number(order.amount_usd).toFixed(2)}</ThemedText>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="receipt-outline" size={32} color={Palette.slate} />
              <ThemedText type="smallBold">No customer orders yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>Paid product orders and their payment status will appear here.</ThemedText>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Metric({ icon, label, value, tint, ink }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; tint: string; ink: string }) {
  return (
    <View style={[styles.metric, { backgroundColor: tint }]}>
      <Ionicons name={icon} size={19} color={ink} />
      <ThemedText type="smallBold" style={[styles.metricValue, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit>{value}</ThemedText>
      <ThemedText type="small" style={[styles.metricLabel, { color: ink }]}>{label}</ThemedText>
    </View>
  );
}

function SectionHeading({ icon, title, action, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionTitle}><Ionicons name={icon} size={19} color={Palette.blue} /><ThemedText type="subtitle">{title}</ThemedText></View>
      <Pressable onPress={onPress} hitSlop={8}><ThemedText type="smallBold" style={styles.sectionAction}>{action}</ThemedText></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  hero: { borderRadius: 24, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#ECFCCB', borderWidth: 1, borderColor: '#BEF264', elevation: 5, shadowColor: '#365314', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.14, shadowRadius: 10 },
  storeIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#D9F99D', alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, gap: 3 },
  heroTitle: { color: '#365314', fontSize: 23, lineHeight: 28 },
  heroText: { color: '#4D7C0F', lineHeight: 18 },
  heroActions: { gap: Spacing.two },
  primaryButton: { minHeight: 52, borderRadius: 16, backgroundColor: '#C7F36B', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, elevation: 4, shadowColor: '#365314', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 8 },
  primaryButtonText: { color: '#1F2937', fontWeight: '800' },
  outlineButton: { minHeight: 50, borderRadius: 16, backgroundColor: Palette.blueSoft, borderWidth: 1, borderColor: '#7DD3FC', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  outlineButtonText: { color: Palette.blueDark, fontWeight: '700' },
  metricsRow: { flexDirection: 'row', gap: Spacing.two },
  metric: { flex: 1, minWidth: 0, borderRadius: 17, padding: 12, gap: 2 },
  metricValue: { fontSize: 18, lineHeight: 23 },
  metricLabel: { fontSize: 10, lineHeight: 14 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.one },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  sectionAction: { color: Palette.blue, fontSize: 12 },
  cardList: { gap: Spacing.two },
  productCard: { minHeight: 82, borderRadius: 18, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  productImage: { width: 62, height: 62, borderRadius: 14 },
  productPlaceholder: { backgroundColor: Palette.ashSoft, alignItems: 'center', justifyContent: 'center' },
  productCopy: { flex: 1, gap: 2 },
  price: { color: Palette.blueDark },
  orderCard: { minHeight: 82, borderRadius: 18, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  orderIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  orderCopy: { flex: 1, gap: 2 },
  orderStatus: { color: Palette.green, fontSize: 11 },
  orderAmount: { color: Palette.blueDark },
  emptyCard: { padding: Spacing.four, borderRadius: 18, backgroundColor: Palette.ashSoft, borderWidth: 1, borderColor: Palette.ash, alignItems: 'center', gap: 7 },
  emptyText: { textAlign: 'center', lineHeight: 18 },
});
