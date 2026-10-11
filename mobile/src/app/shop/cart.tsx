import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SellerLink } from '@/components/listing-card';
import { createCartPaymentIntent, getCartQuote, submitCartCheckout, type CartCheckoutResult, type CartQuoteLine } from '@/api/cart';
import { orderAction, type CatalogueOrder } from '@/api/catalogue';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { MAX_LINE_QUANTITY, useCart, type CartLine } from '@/contexts/CartContext';
import { useTheme } from '@/hooks/use-theme';
import { API_BASE_URL, ApiError } from '@/lib/api-client';
import { loadRemoteConfig } from '@/lib/remote-config';

type PayMethod = 'paystack' | 'usdt_bsc' | 'usdt_tron';

const STATUS_LABEL: Record<CatalogueOrder['status'], string> = {
  paid: 'Paid – awaiting delivery',
  pending_verification: 'USDT verifying',
  buyer_confirmed: 'You confirmed delivery',
  disputed: 'Dispute raised',
  released: 'Funds released to seller',
};

const usd = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ngn = (value: number) => `₦${Math.round(value).toLocaleString()}`;

export default function CartScreen() {
  const theme = useTheme();
  const router = useRouter();
  const cart = useCart();
  const { participant } = useAuth();

  const [name, setName] = useState(participant?.name ?? '');
  const [email, setEmail] = useState(participant?.email ?? '');
  const [whatsapp, setWhatsapp] = useState('');
  const [selectedMethod, setMethod] = useState<PayMethod>('paystack');
  const [txHash, setTxHash] = useState('');
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<CartCheckoutResult | null>(null);
  // Paystack reference awaiting confirmation. `returned` = Paystack redirected
  // back, i.e. the buyer has paid: never offer a second charge, only retries.
  const [pendingPayment, setPendingPayment] = useState<{ reference: string; returned: boolean } | null>(null);

  const requestLines = useMemo(() => cart.lines.map((line) => ({ item_id: line.item_id, quantity: line.quantity })), [cart.lines]);
  const quoteKey = requestLines.map((line) => `${line.item_id}:${line.quantity}`).join(',');
  const quoteQuery = useQuery({
    queryKey: ['cart-quote', quoteKey],
    queryFn: () => getCartQuote(requestLines),
    enabled: requestLines.length > 0 && !result,
    placeholderData: (previous) => previous,
  });
  const quote = quoteQuery.data;

  const { syncFromQuote } = cart;
  useEffect(() => {
    if (quote) syncFromQuote(quote.lines);
  }, [quote, syncFromQuote]);

  const allowed = quote?.payment_methods ?? ['paystack', 'usdt'];
  const method: PayMethod = !allowed.includes('paystack') && selectedMethod === 'paystack' ? 'usdt_bsc'
    : !allowed.includes('usdt') && selectedMethod !== 'paystack' ? 'paystack'
      : selectedMethod;

  useEffect(() => {
    if (method === 'usdt_bsc' || method === 'usdt_tron') {
      loadRemoteConfig().then((cfg) => setCryptoAddress(method === 'usdt_bsc' ? cfg.crypto.addresses.bsc : cfg.crypto.addresses.tron));
    }
  }, [method]);

  // Group lines by seller - each seller gets their own escrow order.
  const groups = useMemo(() => {
    const quoted = new Map((quote?.lines ?? []).map((line) => [line.item_id, line]));
    const bySeller = new Map<string, { line: CartLine; quoted?: CartQuoteLine }[]>();
    for (const line of cart.lines) {
      const q = quoted.get(line.item_id);
      const seller = q?.seller_username || line.seller_username || 'unknown';
      bySeller.set(seller, [...(bySeller.get(seller) ?? []), { line, quoted: q }]);
    }
    return [...bySeller.entries()];
  }, [cart.lines, quote]);

  const stale = quoteQuery.isFetching || quoteQuery.isPlaceholderData;
  const canPay = !!quote && quote.checkout_enabled && !quote.has_problems && !stale && quote.total_usd > 0
    && !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !processing;

  function handleFailure(e: unknown) {
    const message = e instanceof ApiError ? e.message : 'Checkout failed. Please try again.';
    setError(message);
    if (e instanceof ApiError && e.status === 409) void quoteQuery.refetch();
  }

  function complete(done: CartCheckoutResult) {
    setPendingPayment(null);
    setResult(done);
    cart.clear();
  }

  async function confirmPaystack(reference: string) {
    setProcessing(true);
    setError(null);
    setNotice(null);
    try {
      complete(await submitCartCheckout({
        payment_method: 'paystack',
        payment_ref: reference,
        buyer_name: name.trim(),
        buyer_email: email.trim(),
        buyer_whatsapp: whatsapp.trim() || undefined,
      }));
    } catch (e) {
      handleFailure(e);
    } finally {
      setProcessing(false);
    }
  }

  async function payWithPaystack() {
    setProcessing(true);
    setError(null);
    setNotice(null);
    try {
      const redirectUrl = Linking.createURL('paystack-callback');
      const intent = await createCartPaymentIntent({ lines: requestLines, buyer_email: email.trim(), callback_url: redirectUrl });
      setPendingPayment({ reference: intent.reference, returned: false });
      const browser = await WebBrowser.openAuthSessionAsync(intent.authorization_url, redirectUrl);
      if (browser.type !== 'success' || !browser.url) {
        setNotice('Payment was not completed. If you did pay before closing the page, tap "I already paid".');
        return;
      }
      const returned = new URL(browser.url);
      const reference = returned.searchParams.get('reference') || returned.searchParams.get('trxref') || intent.reference;
      setPendingPayment({ reference, returned: true });
      setProcessing(false);
      await confirmPaystack(reference);
      return;
    } catch (e) {
      handleFailure(e);
    } finally {
      setProcessing(false);
    }
  }

  async function submitUsdt() {
    if (!txHash.trim()) return;
    setProcessing(true);
    setError(null);
    setNotice(null);
    try {
      const done = await submitCartCheckout({
        payment_method: 'usdt',
        network: method === 'usdt_bsc' ? 'bsc' : 'tron',
        tx_hash: txHash.trim(),
        lines: requestLines,
        buyer_name: name.trim(),
        buyer_email: email.trim(),
        buyer_whatsapp: whatsapp.trim() || undefined,
      });
      if (done.pending) {
        setNotice(done.error || 'Your transaction is still confirming on-chain. Submit again in a minute.');
        return;
      }
      complete(done);
    } catch (e) {
      handleFailure(e);
    } finally {
      setProcessing(false);
    }
  }

  if (result) return <CheckoutComplete result={result} onContinue={() => router.replace('/shop' as never)} />;

  if (!cart.lines.length) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Your cart' }} />
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}><Ionicons name="cart-outline" size={40} color={Palette.lemonInk} /></View>
          <ThemedText type="subtitle">Your cart is empty</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>Tap the cart circle on any listing to add it here. You can buy from several sellers in one payment.</ThemedText>
          <Pressable onPress={() => router.replace('/shop' as never)} style={styles.primaryButton}>
            <ThemedText style={styles.primaryButtonText}>Browse the shop</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `Your cart (${cart.count})` }} />
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {groups.map(([seller, entries]) => (
            <View key={seller} style={[styles.group, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
              <View style={styles.groupHeader}>
                <Ionicons name="storefront-outline" size={16} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary">Sold by</ThemedText>
                <SellerLink username={seller === 'unknown' ? null : seller} />
              </View>
              {entries.map(({ line, quoted }) => (
                <CartRow
                  key={line.item_id}
                  line={line}
                  quoted={quoted}
                  onOpen={() => router.push(`/catalogue/item/${line.item_id}` as never)}
                  onQuantity={(quantity) => cart.setQuantity(line.item_id, quantity)}
                  onRemove={() => cart.remove(line.item_id)}
                />
              ))}
            </View>
          ))}

          <View style={[styles.summary, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">Order summary</ThemedText>
            {quoteQuery.isLoading ? <ActivityIndicator /> : quoteQuery.isError && !quote ? (
              <Pressable onPress={() => quoteQuery.refetch()}>
                <ThemedText style={styles.error}>Couldn&apos;t price your cart. Tap to retry.</ThemedText>
              </Pressable>
            ) : quote ? (
              <>
                <SummaryRow label={`Items (${cart.count})`} value={usd(quote.subtotal_usd)} />
                <SummaryRow
                  label="Service charge"
                  hint={quote.fee_policy.percent > 0
                    ? `${quote.fee_policy.percent}% of items${quote.fee_policy.cap_usd !== null ? `, capped at ${usd(quote.fee_policy.cap_usd)}${method === 'paystack' && quote.fee_policy.cap_ngn ? ` (≈ ${ngn(quote.fee_policy.cap_ngn)})` : ''}` : ''}`
                    : 'No service charge'}
                  value={usd(quote.service_fee_usd)}
                />
                <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
                <SummaryRow label="Total" value={usd(quote.total_usd)} strong />
                {method === 'paystack' ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Paystack charges {ngn(quote.total_ngn)} at today&apos;s rate of {ngn(quote.exchange_rate)} per $1.
                  </ThemedText>
                ) : null}
                {stale ? <ThemedText type="small" themeColor="textSecondary">Updating prices…</ThemedText> : null}
              </>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              Each seller receives their own order. Your payment is held in escrow until you confirm delivery. The service charge is paid only when your purchase is completed.
            </ThemedText>
          </View>

          {quote && !quote.checkout_enabled ? (
            <ThemedText style={styles.error}>Cart checkout is being set up. Please buy listings individually for now.</ThemedText>
          ) : null}
          {quote?.has_problems ? (
            <ThemedText style={styles.error}>Remove or fix the highlighted listings before paying.</ThemedText>
          ) : null}

          <ThemedText type="smallBold">Your details</ThemedText>
          <TextInput placeholder="Full name" placeholderTextColor={theme.textSecondary} value={name} onChangeText={setName} style={input} />
          <TextInput placeholder="Email" placeholderTextColor={theme.textSecondary} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={input} />
          <TextInput placeholder="WhatsApp (optional)" placeholderTextColor={theme.textSecondary} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" style={input} />

          <ThemedText type="smallBold">Payment method</ThemedText>
          <View style={styles.methodRow}>
            {allowed.includes('paystack') ? <MethodChip label="Paystack (NGN)" selected={method === 'paystack'} onPress={() => setMethod('paystack')} /> : null}
            {allowed.includes('usdt') ? (
              <>
                <MethodChip label="USDT (BSC)" selected={method === 'usdt_bsc'} onPress={() => setMethod('usdt_bsc')} />
                <MethodChip label="USDT (Tron)" selected={method === 'usdt_tron'} onPress={() => setMethod('usdt_tron')} />
              </>
            ) : null}
          </View>
          {!allowed.length ? <ThemedText style={styles.error}>These listings don&apos;t share a payment method. Check out sellers separately.</ThemedText> : null}

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
          {notice ? <ThemedText type="small" style={styles.notice}>{notice}</ThemedText> : null}

          {pendingPayment ? (
            <View style={styles.usdt}>
              <Pressable onPress={() => confirmPaystack(pendingPayment.reference)} disabled={processing} style={[styles.payButton, processing && styles.disabled]}>
                {processing ? <ActivityIndicator color={Palette.lemonInk} /> : (
                  <ThemedText style={styles.payButtonText}>{pendingPayment.returned ? 'Retry confirming payment' : 'I already paid – confirm'}</ThemedText>
                )}
              </Pressable>
              {pendingPayment.returned ? (
                <ThemedText type="small" themeColor="textSecondary">Your payment went through. Retrying will not charge you again. Reference: {pendingPayment.reference}</ThemedText>
              ) : null}
            </View>
          ) : null}

          {pendingPayment?.returned ? null : method === 'paystack' ? (
            <Pressable onPress={payWithPaystack} disabled={!canPay} style={[styles.payButton, !canPay && styles.disabled]}>
              {processing ? <ActivityIndicator color={Palette.lemonInk} /> : (
                <ThemedText style={styles.payButtonText}>Pay {quote ? usd(quote.total_usd) : ''} with Paystack</ThemedText>
              )}
            </Pressable>
          ) : (
            <View style={styles.usdt}>
              <ThemedText type="small">Send exactly {quote ? usd(quote.total_usd) : '…'} in USDT ({method === 'usdt_bsc' ? 'BEP-20' : 'TRC-20'}) to:</ThemedText>
              <Pressable onPress={() => { if (cryptoAddress) { void Clipboard.setStringAsync(cryptoAddress); Alert.alert('Copied', 'Wallet address copied.'); } }} style={input}>
                <ThemedText type="code" style={styles.address}>{cryptoAddress || 'Loading address…'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Tap to copy</ThemedText>
              </Pressable>
              <TextInput placeholder="Paste your transaction hash" placeholderTextColor={theme.textSecondary} value={txHash} onChangeText={setTxHash} autoCapitalize="none" style={input} />
              <Pressable onPress={submitUsdt} disabled={!canPay || !txHash.trim()} style={[styles.payButton, (!canPay || !txHash.trim()) && styles.disabled]}>
                {processing ? <ActivityIndicator color={Palette.lemonInk} /> : <ThemedText style={styles.payButtonText}>Submit payment</ThemedText>}
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">Your transaction is verified on-chain. One transaction pays for the whole cart.</ThemedText>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function CartRow({ line, quoted, onOpen, onQuantity, onRemove }: {
  line: CartLine;
  quoted?: CartQuoteLine;
  onOpen: () => void;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const image = quoted?.image ?? line.image;
  const unit = quoted && !quoted.problem ? quoted.unit_price_usd : line.price_usd;
  const max = Math.min(MAX_LINE_QUANTITY, quoted?.max_order_qty || MAX_LINE_QUANTITY);
  const min = Math.max(1, quoted?.min_order_qty || 1);
  return (
    <View style={styles.row}>
      <Pressable onPress={onOpen}>
        {image ? <Image source={{ uri: image }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbFallback]}><Ionicons name="image" size={20} color={Palette.slate} /></View>}
      </Pressable>
      <View style={styles.rowCopy}>
        <Pressable onPress={onOpen}>
          <ThemedText type="smallBold" numberOfLines={2}>{quoted?.title || line.title || 'Listing'}</ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">{usd(unit)} each</ThemedText>
        {quoted?.problem ? <ThemedText type="small" style={styles.error}>{quoted.problem}</ThemedText> : null}
        <View style={styles.rowActions}>
          <View style={[styles.stepper, { borderColor: theme.backgroundSelected }]}>
            <Pressable hitSlop={6} disabled={line.quantity <= min} onPress={() => onQuantity(line.quantity - 1)} style={styles.stepButton} accessibilityLabel="Decrease quantity">
              <Ionicons name="remove" size={16} color={line.quantity <= min ? theme.textSecondary : theme.text} />
            </Pressable>
            <ThemedText type="smallBold" style={styles.qty}>{line.quantity}</ThemedText>
            <Pressable hitSlop={6} disabled={line.quantity >= max} onPress={() => onQuantity(line.quantity + 1)} style={styles.stepButton} accessibilityLabel="Increase quantity">
              <Ionicons name="add" size={16} color={line.quantity >= max ? theme.textSecondary : theme.text} />
            </Pressable>
          </View>
          <Pressable hitSlop={6} onPress={onRemove} accessibilityLabel="Remove from cart">
            <Ionicons name="trash-outline" size={18} color={Palette.red} />
          </Pressable>
          <ThemedText type="smallBold" style={styles.lineTotal}>{usd(unit * line.quantity)}</ThemedText>
        </View>
      </View>
    </View>
  );
}

function SummaryRow({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryLabel}>
        <ThemedText type={strong ? 'smallBold' : 'small'} style={strong ? styles.totalText : undefined}>{label}</ThemedText>
        {hint ? <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>{hint}</ThemedText> : null}
      </View>
      <ThemedText type="smallBold" style={strong ? styles.totalText : undefined}>{value}</ThemedText>
    </View>
  );
}

function MethodChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.methodChip, { backgroundColor: selected ? Palette.blue : theme.backgroundElement, borderColor: selected ? Palette.blue : theme.backgroundSelected }]}>
      <ThemedText type="smallBold" style={selected ? { color: Palette.white } : undefined}>{label}</ThemedText>
    </Pressable>
  );
}

function CheckoutComplete({ result, onContinue }: { result: CartCheckoutResult; onContinue: () => void }) {
  const theme = useTheme();
  const router = useRouter();
  const [orders, setOrders] = useState(result.orders);
  const { checkout } = result;

  async function act(order: CatalogueOrder, action: 'confirm_delivery' | 'raise_dispute') {
    try {
      const updated = await orderAction({ order_id: order.id, action, buyer_token: order.buyer_token });
      setOrders((current) => current.map((o) => (o.id === order.id ? { ...o, ...updated.order } : o)));
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Please try again.');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Order placed' }} />
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.successHead}>
            <View style={styles.emptyIcon}><Ionicons name="checkmark-done" size={36} color={Palette.lemonInk} /></View>
            <ThemedText type="subtitle">Payment received</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              {orders.length} order{orders.length === 1 ? '' : 's'} created. Copy each order's link before leaving – you'll need it to confirm delivery or raise an issue later.
            </ThemedText>
          </View>

          <View style={[styles.summary, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
            <SummaryRow label="Items" value={usd(checkout.subtotal_usd)} />
            <SummaryRow label="Service charge" value={usd(checkout.service_fee_usd)} />
            <SummaryRow label="Total paid" value={checkout.currency === 'NGN' && checkout.amount_ngn ? `${usd(checkout.total_usd)} (${ngn(checkout.amount_ngn)})` : usd(checkout.total_usd)} strong />
          </View>

          {orders.map((order) => (
            <View key={order.id} style={[styles.group, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" numberOfLines={2}>{order.catalogue_items?.title || 'Listing'}{order.quantity && order.quantity > 1 ? ` × ${order.quantity}` : ''}</ThemedText>
              <SellerLink username={order.seller_username} />
              <ThemedText type="small" themeColor="textSecondary">{usd(Number(order.amount_usd))} · {STATUS_LABEL[order.status]} · #{order.id.slice(0, 8)}</ThemedText>
              <View style={styles.orderActions}>
                {['paid', 'pending_verification'].includes(order.status) ? (
                  <>
                    <Pressable onPress={() => act(order, 'confirm_delivery')} style={[styles.smallButton, { backgroundColor: Palette.blue }]}>
                      <ThemedText type="smallBold" style={{ color: Palette.white }}>Received</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => act(order, 'raise_dispute')} style={[styles.smallButton, styles.disputeButton]}>
                      <ThemedText type="smallBold" style={{ color: Palette.red }}>Issue</ThemedText>
                    </Pressable>
                  </>
                ) : null}
                <Pressable
                  onPress={() => {
                    void Clipboard.setStringAsync(`${API_BASE_URL}/catalogue-product.html?order=${order.id}&token=${order.buyer_token}`);
                    Alert.alert('Link copied', 'Open this link any time to confirm delivery or message the seller.');
                  }}
                  style={[styles.smallButton, styles.linkButton]}
                >
                  <ThemedText type="smallBold" style={{ color: Palette.blue }}>Copy link</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => router.push({ pathname: '/catalogue/order-chat', params: { orderId: order.id, buyerToken: order.buyer_token, title: order.catalogue_items?.title || 'Order' } } as never)}
                  style={[styles.smallButton, styles.chatButton]}
                >
                  <ThemedText type="smallBold" style={{ color: Palette.white }}>Message seller</ThemedText>
                </Pressable>
              </View>
            </View>
          ))}

          <Pressable onPress={onContinue} style={styles.payButton}>
            <ThemedText style={styles.payButtonText}>Continue shopping</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  center: { textAlign: 'center' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Palette.lemon, alignItems: 'center', justifyContent: 'center' },
  successHead: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  group: { borderRadius: 16, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', gap: Spacing.three, paddingTop: Spacing.two },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  thumbFallback: { backgroundColor: Palette.ashSoft, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.one },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999 },
  stepButton: { paddingHorizontal: 10, paddingVertical: 6 },
  qty: { minWidth: 22, textAlign: 'center' },
  lineTotal: { marginLeft: 'auto', color: Palette.blue },
  summary: { borderRadius: 16, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.three },
  summaryLabel: { flex: 1 },
  hint: { fontSize: 12 },
  totalText: { fontSize: 17 },
  divider: { height: 1 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 14, gap: 2 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  methodChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  usdt: { gap: Spacing.two },
  address: { fontSize: 13 },
  payButton: { minHeight: 54, borderRadius: 999, backgroundColor: Palette.lemon, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, elevation: 4, shadowColor: '#1A2E05', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  payButtonText: { color: Palette.lemonInk, fontWeight: '800', fontSize: 16 },
  primaryButton: { backgroundColor: Palette.blue, borderRadius: 999, paddingVertical: 14, paddingHorizontal: Spacing.four },
  primaryButtonText: { color: Palette.white, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: Palette.red },
  notice: { color: Palette.slate },
  orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  smallButton: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  disputeButton: { borderWidth: 1, borderColor: Palette.red },
  chatButton: { backgroundColor: '#78350f' },
  linkButton: { borderWidth: 1, borderColor: Palette.blue },
});
