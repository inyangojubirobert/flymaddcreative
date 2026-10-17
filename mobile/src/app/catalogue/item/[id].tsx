import { useEffect, useState } from 'react';
import { StyleSheet, Pressable, ActivityIndicator, TextInput, ScrollView, Image, Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cataloguePriceLabel, getCatalogueItem, createItemPaymentIntent, createOrder, orderAction, type CatalogueOrder } from '@/api/catalogue';
import { loadRemoteConfig } from '@/lib/remote-config';
import { DigitalProductPanel, useDigitalProduct } from '@/components/digital-product';
import { AppreciationPrompt } from '@/components/gift-art';
import { recordAffiliateIntent, rememberAffiliateToken } from '@/lib/affiliate-attribution';
import { ApiError } from '@/lib/api-client';

type PayMethod = 'paystack' | 'usdt_bsc' | 'usdt_tron';
type Step = 'form' | 'processing' | 'usdt_pending_hash' | 'order_created' | 'error';

const STATUS_LABEL: Record<CatalogueOrder['status'], string> = {
  paid: '💰 Paid – Awaiting Delivery',
  pending_verification: '🔍 USDT Verifying',
  buyer_confirmed: '✅ You Confirmed Delivery',
  disputed: '⚠️ Dispute Raised',
  released: '🟢 Funds Released to Seller',
};

export default function CatalogueItemScreen() {
  const { id, aff } = useLocalSearchParams<{ id: string; aff?: string }>();
  const theme = useTheme();
  const router = useRouter();

  // Arrived through a partner's link: keep the attribution token for checkout.
  useEffect(() => {
    if (id && aff) void rememberAffiliateToken(id, aff);
  }, [id, aff]);

  const itemQuery = useQuery({ queryKey: ['catalogue-item', id], queryFn: () => getCatalogueItem(id), enabled: !!id });
  // Digital products are bought with Google Play and delivered to the Library, not through this checkout.
  const digitalQuery = useDigitalProduct(id);
  const digital = digitalQuery.data?.product ?? null;

  const [selectedMethod, setMethod] = useState<PayMethod>('paystack');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [txHash, setTxHash] = useState('');
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<CatalogueOrder | null>(null);

  const method: PayMethod = itemQuery.data
    && !itemQuery.data.payment_methods?.includes('paystack')
    && itemQuery.data.payment_methods?.includes('usdt')
    && selectedMethod === 'paystack'
    ? 'usdt_bsc'
    : selectedMethod;

  useEffect(() => {
    if (method === 'usdt_bsc' || method === 'usdt_tron') {
      loadRemoteConfig().then((cfg) => setCryptoAddress(method === 'usdt_bsc' ? cfg.crypto.addresses.bsc : cfg.crypto.addresses.tron));
    }
  }, [method]);

  async function payWithPaystack() {
    if (!itemQuery.data) return;
    setStep('processing');
    setError(null);
    try {
      const redirectUrl = Linking.createURL('paystack-callback');
      const intent = await createItemPaymentIntent({ item_id: itemQuery.data.id, callback_url: redirectUrl });
      recordAffiliateIntent({ paymentRef: intent.reference, method: 'paystack', itemIds: [itemQuery.data.id] });
      const result = await WebBrowser.openAuthSessionAsync(intent.authorization_url, redirectUrl);

      if (result.type !== 'success' || !result.url) {
        setStep('form');
        return;
      }

      const returnedUrl = new URL(result.url);
      const reference = returnedUrl.searchParams.get('reference') || returnedUrl.searchParams.get('trxref') || intent.reference;

      const created = await createOrder({
        item_id: itemQuery.data.id,
        buyer_name: name.trim(),
        buyer_email: email.trim(),
        buyer_whatsapp: whatsapp.trim() || undefined,
        delivery_address: deliveryAddress.trim() || undefined,
        payment_method: 'paystack',
        payment_ref: reference,
      });

      setOrder(created);
      setStep('order_created');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Order could not be created.');
      setStep('error');
    }
  }

  async function submitUsdtOrder() {
    if (!itemQuery.data || !txHash.trim()) return;
    setStep('processing');
    setError(null);
    recordAffiliateIntent({ paymentRef: txHash.trim(), method: 'usdt', itemIds: [itemQuery.data.id], buyerEmail: email.trim() });
    try {
      const created = await createOrder({
        item_id: itemQuery.data.id,
        buyer_name: name.trim(),
        buyer_email: email.trim(),
        buyer_whatsapp: whatsapp.trim() || undefined,
        delivery_address: deliveryAddress.trim() || undefined,
        payment_method: 'usdt',
        network: method === 'usdt_bsc' ? 'bsc' : 'tron',
        tx_hash: txHash.trim(),
      });
      setOrder(created);
      setStep('order_created');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Order could not be created.');
      setStep('error');
    }
  }

  async function copyAddress() {
    await Clipboard.setStringAsync(cryptoAddress);
  }

  async function handleConfirmDelivery() {
    if (!order) return;
    try {
      const result = await orderAction({ order_id: order.id, action: 'confirm_delivery', buyer_token: order.buyer_token });
      setOrder(result.order);
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Please try again.');
    }
  }

  async function handleRaiseDispute() {
    if (!order) return;
    try {
      const result = await orderAction({ order_id: order.id, action: 'raise_dispute', buyer_token: order.buyer_token });
      setOrder(result.order);
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Please try again.');
    }
  }

  if (itemQuery.isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" style={styles.loading} />
      </ThemedView>
    );
  }

  if (!itemQuery.data) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.loading}>Listing not found.</ThemedText>
      </ThemedView>
    );
  }

  const item = itemQuery.data;
  const canPaystack = item.payment_methods?.includes('paystack') ?? true;
  const canUsdt = item.payment_methods?.includes('usdt') ?? true;
  const needsDelivery = item.listing_type !== 'service';
  // Private to the seller and support: needed to deliver and follow up.
  const canSubmit = name.trim() && email.trim() && whatsapp.replace(/\D/g, '').length >= 7
    && (!needsDelivery || deliveryAddress.trim().length >= 5);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: item.title }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {step === 'order_created' && order ? (
            <ThemedView style={styles.gap}>
              <ThemedText type="title" style={styles.title}>Order Placed</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">{STATUS_LABEL[order.status]}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Order #{order.id.slice(0, 8)}</ThemedText>
              </ThemedView>
              {['paid', 'pending_verification'].includes(order.status) && (
                <ThemedView style={styles.gap}>
                  <Pressable onPress={handleConfirmDelivery} style={styles.primaryButton}>
                    <ThemedText style={styles.primaryButtonText}>✅ I received my order</ThemedText>
                  </Pressable>
                  <Pressable onPress={handleRaiseDispute} style={styles.disputeButton}>
                    <ThemedText style={styles.disputeButtonText}>⚠️ I have an issue</ThemedText>
                  </Pressable>
                </ThemedView>
              )}
              <Pressable
                onPress={() => router.push({ pathname: '/catalogue/order-chat', params: { orderId: order.id, buyerToken: order.buyer_token, title: item.title } })}
                style={styles.messageSellerButton}
              >
                <ThemedText style={styles.messageSellerButtonText}>💬 Message the Seller</ThemedText>
              </Pressable>
              {order.status === 'buyer_confirmed' && (
                <ThemedText type="small" themeColor="textSecondary">Thank you! Funds will be released to the seller.</ThemedText>
              )}
              <AppreciationPrompt order={order} sellerUsername={item.seller_username} />
            </ThemedView>
          ) : (
            <>
              {item.images?.[0] && <Image source={{ uri: item.images[0] }} style={styles.image} />}
              <View style={styles.listingTypeBadge}>
                <ThemedText type="smallBold" style={styles.listingTypeText}>{item.listing_type === 'service' ? 'Service' : 'Product'}</ThemedText>
              </View>
              <ThemedText type="title" style={styles.title}>{item.title}</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">{item.description}</ThemedText>
              {item.size ? (
                <View style={styles.sizeBadge}>
                  <Ionicons name="resize" size={16} color="#713F12" />
                  <ThemedText type="smallBold" style={styles.sizeText}>Size: {item.size}</ThemedText>
                </View>
              ) : null}
              {item.promo_video_url ? (
                <Pressable onPress={() => void WebBrowser.openBrowserAsync(item.promo_video_url!)} style={styles.videoButton}>
                  <Ionicons name="play-circle" size={22} color="#fff" />
                  <ThemedText style={styles.videoButtonText}>Watch promotional video</ThemedText>
                </Pressable>
              ) : null}
              <ThemedText type="smallBold" style={styles.price}>{cataloguePriceLabel(item)}</ThemedText>
              {item.listing_type === 'service' ? (
                <ThemedView style={styles.card}>
                  {item.service_scope ? (
                    <>
                      <ThemedText type="smallBold">Service scope</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{item.service_scope}</ThemedText>
                    </>
                  ) : null}
                  {item.service_terms ? (
                    <>
                      <ThemedText type="smallBold">Service terms</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{item.service_terms}</ThemedText>
                    </>
                  ) : null}
                  {item.service_details?.service_area ? <ThemedText type="small" themeColor="textSecondary">Coverage: {item.service_details.service_area}</ThemedText> : null}
                  {item.service_details?.typical_duration_minutes ? <ThemedText type="small" themeColor="textSecondary">Typical duration: {item.service_details.typical_duration_minutes} minutes</ThemedText> : null}
                </ThemedView>
              ) : (
                <ThemedView style={styles.card}>
                  {item.product_details?.condition ? <ThemedText type="small" themeColor="textSecondary">Condition: {item.product_details.condition.replaceAll('_', ' ')}</ThemedText> : null}
                  {item.product_details?.fulfillment_methods?.length ? <ThemedText type="small" themeColor="textSecondary">Fulfillment: {item.product_details.fulfillment_methods.map((methodName) => methodName.replaceAll('_', ' ')).join(', ')}</ThemedText> : null}
                  {item.product_details?.delivery_areas ? <ThemedText type="small" themeColor="textSecondary">Delivery areas: {item.product_details.delivery_areas}</ThemedText> : null}
                </ThemedView>
              )}
              {item.attributes?.length ? (
                <ThemedView style={styles.card}>
                  {item.attributes.map((attribute) => (
                    <ThemedText key={attribute.id || attribute.attribute_id || attribute.custom_label} type="small" themeColor="textSecondary">
                      {attribute.custom_label || 'Details'}: {Array.isArray(attribute.value) ? attribute.value.join(', ') : String(attribute.value ?? '')}
                    </ThemedText>
                  ))}
                </ThemedView>
              ) : null}

              {digital ? (
                <DigitalProductPanel product={digital} owned={!!digitalQuery.data?.owned} licenseId={digitalQuery.data?.license_id ?? null} isSeller={!!digitalQuery.data?.is_seller}
                  webPayment={!!digitalQuery.data?.web_payment} subscription={digitalQuery.data?.subscription ?? null} />
              ) : null}
              {!digital && !digitalQuery.isLoading && item.status !== 'active' ? (
                <ThemedText type="small" themeColor="textSecondary">This listing is not available for purchase right now.</ThemedText>
              ) : null}
              {digital || digitalQuery.isLoading || item.status !== 'active' ? null : (<>
              <ThemedText type="smallBold" style={styles.sectionLabel}>Your details</ThemedText>
              <TextInput placeholder="Full name" placeholderTextColor={theme.textSecondary} value={name} onChangeText={setName} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
              <TextInput placeholder="Email" placeholderTextColor={theme.textSecondary} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
              <TextInput placeholder="Phone / WhatsApp" placeholderTextColor={theme.textSecondary} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
              {needsDelivery ? (
                <TextInput placeholder="Delivery address" placeholderTextColor={theme.textSecondary} value={deliveryAddress} onChangeText={setDeliveryAddress} multiline style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, minHeight: 64, textAlignVertical: 'top' }]} />
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">Shared only with the seller and One Dream support to deliver and follow up on your order.</ThemedText>

              <ThemedText type="smallBold" style={styles.sectionLabel}>Payment method</ThemedText>
              <ThemedView style={styles.methodRow}>
                {canPaystack && (
                  <Pressable onPress={() => setMethod('paystack')} style={[styles.methodButton, { backgroundColor: method === 'paystack' ? '#1D4ED8' : theme.backgroundElement }]}>
                    <ThemedText style={method === 'paystack' ? styles.methodTextActive : undefined}>Paystack (NGN)</ThemedText>
                  </Pressable>
                )}
                {canUsdt && (
                  <>
                    <Pressable onPress={() => setMethod('usdt_bsc')} style={[styles.methodButton, { backgroundColor: method === 'usdt_bsc' ? '#1D4ED8' : theme.backgroundElement }]}>
                      <ThemedText style={method === 'usdt_bsc' ? styles.methodTextActive : undefined}>USDT (BSC)</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => setMethod('usdt_tron')} style={[styles.methodButton, { backgroundColor: method === 'usdt_tron' ? '#1D4ED8' : theme.backgroundElement }]}>
                      <ThemedText style={method === 'usdt_tron' ? styles.methodTextActive : undefined}>USDT (Tron)</ThemedText>
                    </Pressable>
                  </>
                )}
              </ThemedView>

              {error && <ThemedText style={styles.error}>{error}</ThemedText>}

              {method === 'paystack' ? (
                <Pressable onPress={payWithPaystack} disabled={!canSubmit || step === 'processing'} style={[styles.primaryButton, { opacity: !canSubmit || step === 'processing' ? 0.6 : 1 }]}>
                  {step === 'processing' ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryButtonText}>Pay with Paystack</ThemedText>}
                </Pressable>
              ) : (
                <ThemedView style={styles.gap}>
                  <ThemedText type="small">Send exactly ${item.price_usd.toFixed(2)} in USDT to:</ThemedText>
                  <Pressable onPress={copyAddress} style={[styles.addressBox, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="code" style={styles.addressText}>{cryptoAddress || 'Loading address…'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Tap to copy</ThemedText>
                  </Pressable>
                  <TextInput placeholder="Paste your transaction hash" placeholderTextColor={theme.textSecondary} value={txHash} onChangeText={setTxHash} autoCapitalize="none" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
                  <Pressable onPress={submitUsdtOrder} disabled={!canSubmit || !txHash.trim() || step === 'processing'} style={[styles.primaryButton, { opacity: !canSubmit || !txHash.trim() || step === 'processing' ? 0.6 : 1 }]}>
                    {step === 'processing' ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryButtonText}>Submit Order</ThemedText>}
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary">USDT orders are manually verified by the seller before delivery.</ThemedText>
                </ThemedView>
              )}
              </>)}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.four, gap: Spacing.three },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  gap: { gap: Spacing.three },
  image: { width: '100%', height: 200, borderRadius: Spacing.two },
  title: { fontSize: 22, marginTop: Spacing.two },
  price: { color: '#1D4ED8', fontSize: 18 },
  listingTypeBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#DBEAFE' },
  listingTypeText: { color: '#1E3A8A', textTransform: 'capitalize' },
  sizeBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: '#FEF3C7' },
  sizeText: { color: '#713F12' },
  videoButton: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#1D4ED8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  videoButtonText: { color: '#fff', fontWeight: '700' },
  sectionLabel: { marginTop: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 14 },
  methodRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  methodButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  methodTextActive: { color: '#fff', fontWeight: '600' },
  addressBox: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
  addressText: { fontSize: 13 },
  primaryButton: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  disputeButton: { borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', borderWidth: 1, borderColor: '#e5484d' },
  disputeButtonText: { color: '#e5484d', fontWeight: '600' },
  messageSellerButton: { backgroundColor: '#78350f', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  messageSellerButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#e5484d', textAlign: 'center' },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
});
