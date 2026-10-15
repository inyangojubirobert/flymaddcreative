import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAvailablePurchases, useIAP, type Purchase } from 'react-native-iap';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { EpubPreview } from '@/components/epub-reader';
import {
  getCreatorPlan, getDigitalProduct, startDigitalCheckout, subscriptionEntryId, verifyCreatorSubscription, verifyDigitalCheckout, verifyDigitalPurchase,
  type DigitalProduct, type ProductSubscriptionOffer,
} from '@/api/digital';
import { monthlyGoogleOffer } from '@/lib/google-play-subscription';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

const KIND_LABEL = { ebook: 'E-book', audio: 'Audio', video: 'Video' } as const;
const KIND_ICON = { ebook: 'book', audio: 'musical-notes', video: 'film' } as const;

/** Digital-product info for a listing (null when the listing is not digital). */
export function useDigitalProduct(itemId?: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ['digital-product', itemId, !!token],
    queryFn: () => getDigitalProduct(itemId!, token),
    enabled: !!itemId,
    staleTime: 30_000,
  });
}

const minutes = (s: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');

export function DigitalProductPanel({ product, owned, licenseId, isSeller, webPayment = false, subscription = null }: {
  product: DigitalProduct; owned: boolean; licenseId: string | null; isSeller: boolean; webPayment?: boolean; subscription?: ProductSubscriptionOffer | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const totalPages = product.contents.reduce((n, c) => n + (c.pages || 0), 0);
  const totalSeconds = product.contents.reduce((n, c) => n + (c.duration_seconds || 0), 0);

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Ionicons name={KIND_ICON[product.kind]} size={14} color={Palette.lemonInk} />
          <ThemedText type="smallBold" style={styles.badgeText}>Digital {KIND_LABEL[product.kind]} · instant access</ThemedText>
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {product.kind === 'ebook' ? (product.contents[0]?.kind === 'epub' ? `EPUB · ${totalPages} sections` : `${totalPages} pages`) : `${product.contents.length} ${product.kind === 'audio' ? 'track' : 'lesson'}${product.contents.length === 1 ? '' : 's'} · ${minutes(totalSeconds)}`}
        {' · '}Opens in your Library, works offline in the app.
      </ThemedText>

      {product.contents.length > 1 ? (
        <View style={styles.contents}>
          {product.contents.map((c, i) => (
            <ThemedText key={c.id} type="small" numberOfLines={1}>{i + 1}. {c.title || `${product.kind === 'audio' ? 'Track' : 'Lesson'} ${i + 1}`} {c.duration_seconds ? `· ${minutes(c.duration_seconds)}` : ''}</ThemedText>
          ))}
        </View>
      ) : null}

      {product.preview ? <Preview preview={product.preview} /> : null}

      {owned && licenseId ? (
        <Pressable onPress={() => router.push(`/library/${licenseId}` as never)} style={styles.primary}>
          <Ionicons name="library" size={18} color={Palette.lemonInk} />
          <ThemedText type="smallBold" style={styles.primaryText}>Open in your Library</ThemedText>
        </Pressable>
      ) : isSeller ? (
        <Pressable onPress={() => router.push(`/catalogue/digital/${product.item_id}` as never)} style={styles.secondary}>
          <ThemedText type="smallBold" style={styles.secondaryText}>Manage your digital product ({product.status.replace('_', ' ')})</ThemedText>
        </Pressable>
      ) : subscription?.subscribed ? (
        <Pressable onPress={() => router.push(`/library/${subscriptionEntryId(product.item_id)}` as never)} style={styles.primary}>
          <Ionicons name="library" size={18} color={Palette.lemonInk} />
          <ThemedText type="smallBold" style={styles.primaryText}>Included in your subscription · Open</ThemedText>
        </Pressable>
      ) : !token ? (
        <Pressable onPress={() => router.push('/(auth)/login' as never)} style={styles.secondary}>
          <ThemedText type="smallBold" style={styles.secondaryText}>Log in to buy</ThemedText>
        </Pressable>
      ) : Platform.OS === 'web' ? (
        webPayment ? <WebBuyButton product={product} /> : <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Card payments are not available right now</ThemedText></View>
      ) : Platform.OS !== 'android' ? (
        <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Available in the One Dream Android app</ThemedText></View>
      ) : product.google_play_product_id ? (
        <DigitalBuyButton product={product} />
      ) : (
        <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Awaiting Google Play configuration</ThemedText></View>
      )}
      {subscription && !subscription.subscribed && !owned && !isSeller && token ? <SubscribeSection offer={subscription} itemId={product.item_id} webPayment={webPayment} /> : null}
      <ThemedText type="small" themeColor="textSecondary">Sold by @{product.seller_username}. Content stays inside the One Dream app and is licensed to your account.</ThemedText>
    </View>
  );
}

function Preview({ preview }: { preview: NonNullable<DigitalProduct['preview']> }) {
  if (preview.type === 'sections') {
    return (
      <View style={styles.previewWrap}>
        <ThemedText type="smallBold">Preview</ThemedText>
        <EpubPreview sections={preview.sections} />
      </View>
    );
  }
  if (preview.type === 'pages') {
    return (
      <View style={styles.previewWrap}>
        <ThemedText type="smallBold">Preview</ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewRow}>
          {preview.pages.map((uri) => <Image key={uri} source={{ uri }} style={styles.previewPage} resizeMode="contain" />)}
        </ScrollView>
      </View>
    );
  }
  return preview.type === 'audio' ? <AudioPreview url={preview.url} seconds={preview.seconds} /> : <VideoPreview url={preview.url} />;
}

function AudioPreview({ url, seconds }: { url: string; seconds: number }) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  return (
    <Pressable onPress={() => (status.playing ? player.pause() : player.play())} style={styles.audioPreview}>
      <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={30} color={Palette.blue} />
      <ThemedText type="smallBold">{status.playing ? 'Playing preview' : `Play ${seconds}-second preview`}</ThemedText>
    </Pressable>
  );
}

function VideoPreview({ url }: { url: string }) {
  const player = useVideoPlayer({ uri: url });
  return (
    <View style={styles.previewWrap}>
      <ThemedText type="smallBold">Preview</ThemedText>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
    </View>
  );
}

/** Google Play purchase of this item's price tier, bound to the item and buyer. */
function DigitalBuyButton({ product }: { product: DigitalProduct }) {
  const { token, participant } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const verifying = useRef(new Set<string>());
  const productId = product.google_play_product_id!;

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: (purchase) => { void complete(purchase); },
    onPurchaseError: (error) => {
      setBusy(false);
      if (!String(error.code).toLowerCase().includes('cancel')) Alert.alert('Purchase not completed', error.message || 'Google Play could not complete the purchase.');
    },
  });

  useEffect(() => {
    if (connected) void fetchProducts({ skus: [productId], type: 'in-app' }).catch(() => {});
  }, [connected, productId, fetchProducts]);

  const playProduct = products.find((p) => p.id === productId);

  async function complete(purchase: Purchase) {
    if (!token || purchase.productId !== productId || !purchase.purchaseToken || verifying.current.has(purchase.purchaseToken)) return;
    verifying.current.add(purchase.purchaseToken);
    try {
      const result = await verifyDigitalPurchase(token, { productId, purchaseToken: purchase.purchaseToken, itemId: product.item_id });
      if (result.pending) {
        Alert.alert('Payment pending', 'Google Play is still processing this payment. It will appear in your Library once it completes.');
        return;
      }
      await finishTransaction({ purchase, isConsumable: true }).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: ['digital-product', product.item_id] });
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      if (result.license_id) router.push(`/library/${result.license_id}` as never);
    } catch (error) {
      Alert.alert('Could not confirm purchase', error instanceof ApiError ? error.message : 'Open your Library shortly - purchases are confirmed automatically.');
    } finally {
      verifying.current.delete(purchase.purchaseToken);
      setBusy(false);
    }
  }

  function buy() {
    if (!participant || !playProduct) return;
    // Google charges the Play Console price; a USD tier must match ours exactly.
    if (playProduct.currency === 'USD' && typeof playProduct.price === 'number' && product.price_usd !== null && Math.abs(playProduct.price - product.price_usd) > 0.01) {
      Alert.alert('Temporarily unavailable', 'The price of this item is being updated. Please try again later.');
      return;
    }
    setBusy(true);
    void requestPurchase({
      type: 'in-app',
      request: { google: { skus: [productId], obfuscatedAccountIdAndroid: participant.id, obfuscatedProfileIdAndroid: product.item_id } },
    }).catch((error) => {
      setBusy(false);
      Alert.alert('Purchase not started', error instanceof Error ? error.message : 'Please try again.');
    });
  }

  if (!connected) return <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Connecting to Google Play…</ThemedText></View>;
  if (!playProduct) return <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Awaiting Google Play configuration</ThemedText></View>;
  return (
    <Pressable onPress={buy} disabled={busy} style={[styles.primary, busy && styles.disabled]}>
      {busy ? <ActivityIndicator color={Palette.lemonInk} /> : (
        <>
          <Ionicons name="logo-google-playstore" size={18} color={Palette.lemonInk} />
          <ThemedText type="smallBold" style={styles.primaryText}>Buy · {playProduct.displayPrice}</ThemedText>
        </>
      )}
    </Pressable>
  );
}

/** Paystack card checkout (web app only; Google Play policy keeps Android purchases in Google Play). */
async function payOnWeb(token: string, input: { purpose: 'purchase'; item_id: string } | { purpose: 'subscription'; creator_username: string }) {
  const redirectUrl = Linking.createURL('paystack-callback');
  const intent = await startDigitalCheckout(token, { ...input, callback_url: redirectUrl });
  const result = await WebBrowser.openAuthSessionAsync(intent.authorization_url, redirectUrl);
  const returned = result.type === 'success' && result.url ? new URL(result.url).searchParams.get('reference') : null;
  // Even if the window was closed, the payment may have gone through: check it.
  return verifyDigitalCheckout(token, returned || intent.reference);
}

function WebBuyButton({ product }: { product: DigitalProduct }) {
  const { token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function buy() {
    setBusy(true);
    try {
      const result = await payOnWeb(token!, { purpose: 'purchase', item_id: product.item_id });
      if (result.pending) { Alert.alert('Payment not completed', 'If you paid, it will appear in your Library shortly.'); return; }
      await queryClient.invalidateQueries({ queryKey: ['digital-product', product.item_id] });
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      if (result.license_id) router.push(`/library/${result.license_id}` as never);
    } catch (error) {
      Alert.alert('Payment', error instanceof ApiError ? error.message : 'Could not start the payment. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Pressable onPress={() => void buy()} disabled={busy} style={[styles.primary, busy && styles.disabled]}>
      {busy ? <ActivityIndicator color={Palette.lemonInk} /> : (
        <>
          <Ionicons name="card" size={18} color={Palette.lemonInk} />
          <ThemedText type="smallBold" style={styles.primaryText}>Buy · ${product.price_usd?.toFixed(2)} (card, NGN)</ThemedText>
        </>
      )}
    </Pressable>
  );
}

/** Creator's monthly subscription: every included item while it is paid. */
function SubscribeSection({ offer, itemId, webPayment }: { offer: ProductSubscriptionOffer; itemId: string; webPayment: boolean }) {
  const { token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['digital-product', itemId] });
    await queryClient.invalidateQueries({ queryKey: ['library'] });
    router.push(`/library/${subscriptionEntryId(itemId)}` as never);
  };
  async function subscribeOnWeb() {
    setBusy(true);
    try {
      const result = await payOnWeb(token!, { purpose: 'subscription', creator_username: offer.creator_username });
      if (result.pending) { Alert.alert('Payment not completed', 'If you paid, your subscription will start shortly.'); return; }
      await done();
    } catch (error) {
      Alert.alert('Subscription', error instanceof ApiError ? error.message : 'Could not start the payment. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.subscribe}>
      <ThemedText type="smallBold">Or subscribe to @{offer.creator_username}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        ${offer.price_usd.toFixed(2)}/month for this and everything else @{offer.creator_username} includes. Renews monthly; cancel any time and keep access until the month ends.
      </ThemedText>
      {offer.description ? <ThemedText type="small">{offer.description}</ThemedText> : null}
      {Platform.OS === 'web' ? (
        webPayment ? (
          <Pressable onPress={() => void subscribeOnWeb()} disabled={busy} style={[styles.secondary, styles.row, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color={Palette.blueDark} /> : <ThemedText type="smallBold" style={styles.secondaryText}>Subscribe · ${offer.price_usd.toFixed(2)}/month (card)</ThemedText>}
          </Pressable>
        ) : null
      ) : Platform.OS === 'android' ? <GoogleSubscribeButton creator={offer.creator_username} onDone={done} /> : null}
    </View>
  );
}

function GoogleSubscribeButton({ creator, onDone }: { creator: string; onDone: () => Promise<void> }) {
  const { token, participant } = useAuth();
  const [busy, setBusy] = useState(false);
  const verifying = useRef(new Set<string>());
  const planQuery = useQuery({ queryKey: ['creator-plan', creator, !!token], queryFn: () => getCreatorPlan(creator, token), staleTime: 60_000 });
  const plan = planQuery.data?.plan;
  const productIds = plan?.google_play_products ?? [];

  const { connected, subscriptions, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: (purchase) => { void complete(purchase); },
    onPurchaseError: (error) => {
      setBusy(false);
      if (!String(error.code).toLowerCase().includes('cancel')) Alert.alert('Subscription not completed', error.message || 'Google Play could not complete the purchase.');
    },
  });

  useEffect(() => {
    if (connected && productIds.length) void fetchProducts({ skus: productIds, type: 'subs' }).catch(() => {});
  }, [connected, productIds.join(','), fetchProducts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function complete(purchase: Purchase) {
    if (!token || !productIds.includes(purchase.productId) || !purchase.purchaseToken || verifying.current.has(purchase.purchaseToken)) return;
    verifying.current.add(purchase.purchaseToken);
    try {
      const result = await verifyCreatorSubscription(token, { productId: purchase.productId, purchaseToken: purchase.purchaseToken, creatorUsername: creator });
      if (result.pending) { Alert.alert('Payment pending', 'Google Play is still processing this payment. Your subscription starts once it completes.'); return; }
      await finishTransaction({ purchase, isConsumable: false }).catch(() => {});
      await onDone();
    } catch (error) {
      Alert.alert('Could not confirm subscription', error instanceof ApiError ? error.message : 'Open your Library shortly - purchases are confirmed automatically.');
    } finally {
      verifying.current.delete(purchase.purchaseToken);
      setBusy(false);
    }
  }

  async function subscribe() {
    if (!participant || !plan) return;
    setBusy(true);
    try {
      // Google allows one live subscription per product: use a price "slot" this account doesn't hold yet.
      const held = new Set((await getAvailablePurchases().catch(() => [])).map((p) => p.productId));
      const candidate = productIds
        .filter((id) => !held.has(id))
        .map((id) => subscriptions.find((p) => p.id === id))
        .find((p) => p && monthlyGoogleOffer(p));
      const offer = candidate ? monthlyGoogleOffer(candidate) : undefined;
      if (!candidate || !offer) {
        setBusy(false);
        const configured = productIds.filter((id) => subscriptions.some((p) => p.id === id));
        if (configured.length && configured.every((id) => held.has(id))) {
          // Every slot at this price is already a live subscription on this Google account.
          Alert.alert(
            'Limit reached at this price',
            `Google Play allows ${configured.length} creator subscription${configured.length === 1 ? '' : 's'} at $${plan.price_usd.toFixed(2)}/month per account, and you already have ${configured.length === 1 ? 'it' : 'all of them'}. A slot frees up when one of those subscriptions ends.`,
          );
        } else {
          Alert.alert('Not available right now', 'Subscriptions at this price are being set up in Google Play. Please try again later.');
        }
        return;
      }
      if (candidate.currency === 'USD' && typeof candidate.price === 'number' && Math.abs(candidate.price - plan.price_usd) > 0.01) {
        setBusy(false);
        Alert.alert('Temporarily unavailable', 'This subscription price is being updated. Please try again later.');
        return;
      }
      await requestPurchase({
        type: 'subs',
        request: {
          google: {
            skus: [candidate.id],
            subscriptionOffers: [{ sku: candidate.id, offerToken: offer.offerToken }],
            obfuscatedAccountIdAndroid: participant.id,
            obfuscatedProfileIdAndroid: plan.creator_id,
          },
        },
      });
    } catch (error) {
      setBusy(false);
      Alert.alert('Subscription not started', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  if (!plan || !connected) return <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Connecting to Google Play…</ThemedText></View>;
  const available = productIds.some((id) => subscriptions.some((p) => p.id === id));
  if (!available) return <View style={styles.secondary}><ThemedText type="smallBold" style={styles.secondaryText}>Subscription awaiting Google Play configuration</ThemedText></View>;
  return (
    <Pressable onPress={() => void subscribe()} disabled={busy} style={[styles.secondary, styles.row, busy && styles.disabled]}>
      {busy ? <ActivityIndicator color={Palette.blueDark} /> : (
        <>
          <Ionicons name="logo-google-playstore" size={16} color={Palette.blueDark} />
          <ThemedText type="smallBold" style={styles.secondaryText}>Subscribe · ${plan.price_usd.toFixed(2)}/month</ThemedText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  subscribe: { gap: Spacing.one, borderRadius: 14, padding: Spacing.three, backgroundColor: Palette.blueSoft },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: '#fff' },
  panel: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  badgeRow: { flexDirection: 'row' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Palette.lemon },
  badgeText: { color: Palette.lemonInk },
  contents: { gap: 2 },
  previewWrap: { gap: Spacing.one },
  previewRow: { gap: Spacing.two },
  previewPage: { width: 150, height: 200, borderRadius: 8, backgroundColor: Palette.ashSoft },
  audioPreview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.two, backgroundColor: Palette.blueSoft },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, paddingVertical: 14, backgroundColor: Palette.lemon },
  primaryText: { color: Palette.lemonInk, fontSize: 15 },
  secondary: { borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Palette.blueSoft },
  secondaryText: { color: Palette.blueDark },
  disabled: { opacity: 0.6 },
});
