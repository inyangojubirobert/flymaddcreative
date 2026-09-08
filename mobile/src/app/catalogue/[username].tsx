import { FlatList, StyleSheet, Pressable, ActivityIndicator, Image, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPublicCatalogueByUsername, type CatalogueItem } from '@/api/catalogue';

export default function SellerShopScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const theme = useTheme();

  const itemsQuery = useQuery({
    queryKey: ['catalogue', username],
    queryFn: () => getPublicCatalogueByUsername(username),
    enabled: !!username,
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `@${username}'s Shop` }} />
      <SafeAreaView style={styles.safeArea}>
        {itemsQuery.isLoading ? (
          <ActivityIndicator size="large" style={styles.loading} />
        ) : (
          <FlatList<CatalogueItem>
            data={itemsQuery.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<ThemedText style={styles.empty} themeColor="textSecondary">No items for sale yet.</ThemedText>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => router.push(`/catalogue/item/${item.id}`)}
                style={[styles.card, { backgroundColor: theme.backgroundElement }]}
              >
                {item.images?.[0] && <Image source={{ uri: item.images[0] }} style={styles.image} />}
                <ThemedView style={styles.cardText}>
                  <ThemedText type="smallBold" numberOfLines={1}>{item.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{item.description}</ThemedText>
                  <View style={styles.detailRow}>
                    {item.size ? <ThemedText type="small" themeColor="textSecondary">Size: {item.size}</ThemedText> : null}
                    {item.promo_video_url ? <View style={styles.videoBadge}><Ionicons name="play" size={11} color="#1D4ED8" /><ThemedText type="small" style={styles.videoText}>Video</ThemedText></View> : null}
                  </View>
                  <ThemedText type="smallBold" style={styles.price}>${item.price_usd.toFixed(2)}</ThemedText>
                </ThemedView>
              </Pressable>
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
  loading: { marginTop: Spacing.six },
  list: { gap: Spacing.three, paddingVertical: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  card: { borderRadius: Spacing.two, overflow: 'hidden' },
  image: { width: '100%', height: 160 },
  cardText: { padding: Spacing.three, gap: Spacing.half },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  videoBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#DBEAFE' },
  videoText: { color: '#1D4ED8', fontSize: 10 },
  price: { color: '#1D4ED8' },
});
