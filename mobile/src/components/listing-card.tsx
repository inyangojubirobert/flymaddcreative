import { useEffect } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { cataloguePriceLabel, type CatalogueItem } from '@/api/catalogue';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { MAX_CART_LINES, useCart } from '@/contexts/CartContext';
import { useTheme } from '@/hooks/use-theme';
import { trackAdEvent, type AdPlacement } from '@/api/ads';
import { SponsoredTag } from '@/components/sponsored';

/**
 * Marketplace grid card: opens the listing, toggles it in the cart, links to
 * the seller. `sponsored` marks a paid listing boost: it is labelled and its
 * impressions/clicks are counted for the seller's campaign.
 */
export function ListingCard({ item, width, sponsored }: { item: CatalogueItem; width: number; sponsored?: { campaignId: string; placement: AdPlacement } }) {
  const theme = useTheme();
  const router = useRouter();
  const photo = item.images?.[0];
  useEffect(() => {
    if (sponsored) trackAdEvent(sponsored.campaignId, 'impression', sponsored.placement);
  }, [sponsored?.campaignId, sponsored?.placement]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Pressable
      onPress={() => {
        if (sponsored) trackAdEvent(sponsored.campaignId, 'click', sponsored.placement);
        router.push(`/catalogue/item/${item.id}` as never);
      }}
      style={[styles.card, { width, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={[styles.media, { height: Math.round(width * 0.92) }]}>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : <View style={styles.photoFallback}><Ionicons name="image" size={28} color={Palette.slate} /></View>}
        {item.promo_video_url ? <View style={styles.videoBadge}><Ionicons name="play" size={12} color="#fff" /></View> : null}
        <CartChecker item={item} style={styles.checker} />
        {sponsored ? <SponsoredTag /> : null}
      </View>
      <View style={styles.cardCopy}>
        <ThemedText type="smallBold" numberOfLines={2} style={styles.title}>{item.title}</ThemedText>
        <SellerLink username={item.seller_username} />
        <View style={styles.priceRow}>
          <ThemedText type="smallBold" style={styles.price}>{cataloguePriceLabel(item)}</ThemedText>
          {item.size ? <ThemedText type="small" numberOfLines={1} style={styles.sizePill}>{item.size}</ThemedText> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Round add-to-cart checkbox. Hidden for listings without a fixed price. */
export function CartChecker({ item, style }: { item: CatalogueItem; style?: object }) {
  const cart = useCart();
  if (!(Number(item.price_usd) > 0)) return null;
  const inCart = cart.has(item.id);
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        if (!cart.toggle(item)) Alert.alert('Cart is full', `A cart can hold up to ${MAX_CART_LINES} listings. Check out or remove one first.`);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: inCart }}
      accessibilityLabel={inCart ? `Remove ${item.title} from cart` : `Add ${item.title} to cart`}
      style={[styles.checkerBase, inCart ? styles.checkerOn : styles.checkerOff, style]}
    >
      <Ionicons name={inCart ? 'checkmark' : 'cart-outline'} size={inCart ? 18 : 16} color={inCart ? Palette.lemonInk : Palette.slateDark} />
    </Pressable>
  );
}

/** @seller link to the shop owner's profile (profiles need a signed-in account). */
export function SellerLink({ username, prefix = '@' }: { username?: string | null; prefix?: string }) {
  const router = useRouter();
  const { token } = useAuth();
  if (!username) return null;
  return (
    <Pressable
      hitSlop={6}
      onPress={() => {
        if (token) {
          router.push(`/profile/${username}` as never);
          return;
        }
        Alert.alert('Log in to view sellers', 'Seller profiles are available to signed-in members.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Log in', onPress: () => router.push('/(auth)/login' as never) },
        ]);
      }}
      accessibilityRole="link"
      accessibilityLabel={`View ${username}'s profile`}
      style={styles.seller}
    >
      <Ionicons name="person-circle-outline" size={14} color={Palette.blue} />
      <ThemedText type="small" numberOfLines={1} style={styles.sellerText}>{prefix}{username}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  cardCopy: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 12, gap: 3 },
  media: { backgroundColor: Palette.ashSoft },
  photo: { width: '100%', height: '100%' },
  photoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  videoBadge: { position: 'absolute', right: 8, bottom: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(15,23,42,0.72)', alignItems: 'center', justifyContent: 'center' },
  checker: { position: 'absolute', top: 8, right: 8 },
  checkerBase: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, elevation: 3, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  checkerOff: { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: Palette.ash },
  checkerOn: { backgroundColor: Palette.lemon, borderColor: Palette.lemonInk },
  title: { fontSize: 14, lineHeight: 18 },
  seller: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', maxWidth: '100%' },
  sellerText: { color: Palette.blue, flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 2 },
  price: { color: Palette.blue, fontSize: 15 },
  sizePill: { flexShrink: 1, color: Palette.slate, fontSize: 11 },
});
