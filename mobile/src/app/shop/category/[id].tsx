import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CatalogueBanner } from '@/components/catalogue-visuals';
import { getCategories, getShopFeed } from '@/api/catalogue';
import { FLOATING_CART_SPACE, FloatingCart } from '@/components/floating-cart';
import { ListingCard } from '@/components/listing-card';
import { SponsoredAdCard, useSponsored } from '@/components/sponsored';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildCatalogueDirectory, departmentForCategory } from '@/lib/catalogue-directory';

import { useMarketplaceSearch } from '@/hooks/use-marketplace-search';
import { marketplaceItems } from '@/lib/marketplace-search-results';

export default function CategoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const categoryId = Array.isArray(id) ? id[0] : id;
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');

  const categoriesQuery = useQuery({
    queryKey: ['catalogue-categories'],
    queryFn: getCategories,
  });

  const directory = buildCatalogueDirectory(categoriesQuery.data ?? []);
  const category = (categoriesQuery.data ?? []).find((item) => item.id === categoryId) ?? null;
  const department = categoryId ? departmentForCategory(directory, categoryId) : undefined;

  const itemsQuery = useQuery({
    queryKey: ['shop-items', categoryId],
    queryFn: () => getShopFeed(categoryId ? [categoryId] : null),
    enabled: !!categoryId,
  });

  const cardWidth = Math.floor((width - Spacing.three * 2 - Spacing.three) / 2);
  const needle = query.trim().toLowerCase();
  const searchQuery = useMarketplaceSearch(categoryId ? query : '', { categoryId });
  const sponsored = useSponsored('category', { ads: 1, boosts: 4, categoryId });
  const boosted = (sponsored.data?.boosted ?? []).filter(({ listing }) => !needle
    || [listing.title, listing.description].some((text) => (text || '').toLowerCase().includes(needle)));
  const products = marketplaceItems({
    remote: searchQuery.data?.items, cached: itemsQuery.data, query,
    useLocal: searchQuery.useLocalItems, scopeIds: categoryId ? [categoryId] : [],
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: category?.name || 'Category' }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={itemsQuery.isFetching} onRefresh={() => { categoriesQuery.refetch(); itemsQuery.refetch(); if (query.trim()) searchQuery.refetch(); }} />}
        >
          <CatalogueBanner
            imageUrl={category?.image_url}
            title={category?.banner_title?.trim() || category?.name || 'Category'}
            subtitle={category?.banner_subtitle}
            icon={category?.icon || 'pricetag'}
            tint={category?.tint || Palette.blueSoft}
            ink={category?.ink || Palette.blueDark}
          >
            {department ? (
              <Pressable onPress={() => router.push(`/shop?department=${department.slug}` as never)}>
                <ThemedText type="smallBold" style={{ color: category?.image_url?.trim() ? '#F8FAFC' : category?.ink || Palette.blue }}>in {department.name}</ThemedText>
              </Pressable>
            ) : null}
          </CatalogueBanner>

          <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
            <Ionicons name="search" size={18} color={Palette.blue} />
            <TextInput
              maxLength={200}
              value={query}
              onChangeText={setQuery}
              placeholder={`Search in ${category?.name || 'this category'}`}
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>

          {searchQuery.degraded ? <ThemedText type="small">Some results are unavailable. Pull to retry.</ThemedText> : null}
          {sponsored.data?.ads?.[0] ? <SponsoredAdCard ad={sponsored.data.ads[0]} placement="category" /> : null}
          <ThemedText type="smallBold">{products.length ? `${products.length} listing${products.length === 1 ? '' : 's'}` : 'Listings'}</ThemedText>

          {(needle ? searchQuery.isSearching : itemsQuery.isLoading) || categoriesQuery.isLoading ? (
            <ActivityIndicator size="large" style={styles.loading} />
          ) : !category ? (
            <ThemedText style={styles.empty}>This category was not found.</ThemedText>
          ) : itemsQuery.isError && (!needle || searchQuery.isError) && !products.length ? (
            <ThemedText style={styles.empty}>Couldn&apos;t load listings. Pull to retry.</ThemedText>
          ) : products.length ? (
            <View style={styles.grid}>
              {boosted.map((boost) => (
                <ListingCard key={`boost-${boost.campaign_id}`} item={boost.listing} width={cardWidth} sponsored={{ campaignId: boost.campaign_id, placement: 'category' }} />
              ))}
              {products.map((item) => (
                <ListingCard key={item.id} item={item} width={cardWidth} />
              ))}
            </View>
          ) : (
            <ThemedText style={styles.empty}>{needle ? (searchQuery.degraded ? 'Search is temporarily unavailable. Pull to retry.' : 'No listings match that search.') : 'No products in this category yet.'}</ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>
      <FloatingCart />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + FLOATING_CART_SPACE },
  searchBar: { minHeight: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  loading: { marginTop: Spacing.five },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
