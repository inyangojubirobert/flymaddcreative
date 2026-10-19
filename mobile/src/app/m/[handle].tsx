import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getAdViewerId } from '@/lib/ad-viewer';
import { rememberAffiliateToken } from '@/lib/affiliate-attribution';
import { getStorefront, recordClick, type StorefrontItem } from '@/api/earnings';
import { useCart } from '@/contexts/CartContext';

// Public partner storefront (/m/<handle>). Listings belong to their sellers:
// price, specs, stock and delivery come from the seller's listing. Opening a
// listing records the partner's click so a purchase is attributed to them.
// A reseller's own-price offer (P3) is bought through the cart at that price.

export default function StorefrontScreen() {
  const { handle, via } = useLocalSearchParams<{ handle: string; via?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const query = useQuery({ queryKey: ['storefront', handle], queryFn: () => getStorefront(String(handle)), enabled: !!handle });
  const [opening, setOpening] = useState<string | null>(null);
  const cart = useCart();
  const data = query.data;

  function addResale(item: StorefrontItem) {
    const added = cart.addResale({ item_id: item.item_id, membership_id: item.membership_id, price_usd: item.price_usd, title: item.title, image: item.image });
    if (!added) {
      Alert.alert('Cart is full', 'Check out or remove a listing first.');
      return;
    }
    Alert.alert('Added to cart', `${item.title} at $${item.price_usd.toFixed(2)}, sold by ${item.sold_by}.`, [
      { text: 'Keep browsing', style: 'cancel' },
      { text: 'Open cart', onPress: () => router.push('/shop/cart' as never) },
    ]);
  }

  async function open(item: StorefrontItem) {
    if (!data) return;
    setOpening(item.membership_id);
    try {
      const click = await recordClick(via && /^[A-Za-z0-9]{6,16}$/.test(via) ? via : data.link_code, item.item_id, await getAdViewerId());
      await rememberAffiliateToken(item.item_id, click.token);
    } catch {
      // The listing still opens; only the partner's attribution is lost.
    } finally {
      setOpening(null);
      router.push(`/catalogue/item/${item.item_id}` as never);
    }
  }

  if (query.isLoading) return <ActivityIndicator style={{ marginTop: Spacing.six }} />;
  if (!data) return <ThemedText style={{ margin: Spacing.four, textAlign: 'center' }}>Storefront not found.</ThemedText>;

  const grouped = data.collections.length ? data.collections : [{ title: 'All listings', slug: 'all', items: data.items }];
  const inCollections = new Set(data.collections.flatMap((c) => c.items.map((i) => i.membership_id)));
  const rest = data.items.filter((i) => !inCollections.has(i.membership_id));
  if (data.collections.length && rest.length) grouped.push({ title: 'More', slug: 'more', items: rest });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: data.partner.display_name }} />
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            {data.partner.avatar_url ? <Image source={{ uri: data.partner.avatar_url }} style={styles.avatar} /> : null}
            <ThemedText type="subtitle">{data.partner.display_name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">@{data.partner.handle} · curated listings from One Dream sellers</ThemedText>
            {data.partner.bio ? <ThemedText type="small">{data.partner.bio}</ThemedText> : null}
          </View>
          {grouped.map((group) => (
            <View key={group.slug} style={styles.group}>
              <ThemedText type="smallBold">{group.title}</ThemedText>
              <View style={styles.grid}>
                {group.items.map((item) => {
                  const media = item.creatives.find((c) => c.kind === 'image' && c.media_url)?.media_url || item.image;
                  const text = item.creatives.find((c) => c.kind === 'text')?.body;
                  return (
                    <Pressable key={item.membership_id} onPress={() => void open(item)} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                      {media ? <Image source={{ uri: media }} style={styles.image} /> : <View style={[styles.image, { backgroundColor: Palette.ashSoft }]} />}
                      <ThemedText type="smallBold" numberOfLines={2}>{item.title}</ThemedText>
                      {text ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>{text}</ThemedText> : null}
                      <ThemedText type="smallBold" style={{ color: Palette.blue }}>${item.price_usd.toFixed(2)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        Sold by {item.sold_by}{item.fulfilled_by !== item.sold_by ? ` · ships from ${item.fulfilled_by}` : ''}
                      </ThemedText>
                      {item.resale ? (
                        <Pressable onPress={() => addResale(item)} style={[styles.addButton, { backgroundColor: Palette.blue }]} accessibilityLabel={`Add ${item.title} to cart`}>
                          <ThemedText type="smallBold" style={{ color: '#fff' }}>Add to cart</ThemedText>
                        </Pressable>
                      ) : null}
                      {opening === item.membership_id ? <ActivityIndicator /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {!data.items.length ? <ThemedText themeColor="textSecondary">Nothing here yet.</ThemedText> : null}
          <Pressable onPress={() => Alert.alert('About partner storefronts', 'Partners curate listings from independent One Dream sellers. You buy from the seller through One Dream checkout, with the same buyer protection.')}>
            <ThemedText type="small" style={{ color: Palette.blue, textAlign: 'center' }}>How storefronts work</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, paddingBottom: Spacing.six },
  header: { alignItems: 'center', gap: 4 },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  group: { gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { width: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: Spacing.two, gap: 4 },
  image: { width: '100%', aspectRatio: 1, borderRadius: 10 },
  addButton: { borderRadius: 8, paddingVertical: 6, alignItems: 'center' },
});
