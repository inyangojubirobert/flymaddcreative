import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CatalogueBanner, CatalogueThumb } from '@/components/catalogue-visuals';
import { getCategories, getShopFeed, type CatalogueItem } from '@/api/catalogue';
import { FLOATING_CART_SPACE, FloatingCart } from '@/components/floating-cart';
import { ListingCard } from '@/components/listing-card';
import { SponsoredAdCard, useSponsored } from '@/components/sponsored';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buildCatalogueDirectory, categorySearchText, featuredEntries, hasListingKinds, type ListingKind, type ShopDepartment } from '@/lib/catalogue-directory';

import { useMarketplaceSearch } from '@/hooks/use-marketplace-search';
import { marketplaceItems } from '@/lib/marketplace-search-results';

type ShopFeed = 'foryou' | 'new' | 'popular' | 'following';

const FEEDS: { id: ShopFeed; label: string }[] = [
  { id: 'foryou', label: 'For you' },
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'New' },
  { id: 'following', label: 'Following' },
];

export default function ShopScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; department?: string; view?: string }>();
  const { width } = useWindowDimensions();
  const [departmentSlug, setDepartmentSlug] = useState<string | null>(paramValue(params.department));
  const [showDirectory, setShowDirectory] = useState(paramValue(params.view) === 'directory');
  const [feed, setFeed] = useState<ShopFeed>('foryou');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const categoryFromParams = paramValue(params.category);
    if (categoryFromParams) {
      router.replace(`/shop/category/${categoryFromParams}` as never);
      return;
    }
    setDepartmentSlug(paramValue(params.department));
    setShowDirectory(paramValue(params.view) === 'directory' && !paramValue(params.department));
  }, [params.department, params.category, params.view, router]);

  const categoriesQuery = useQuery({
    queryKey: ['catalogue-categories'],
    queryFn: getCategories,
  });

  const directory = buildCatalogueDirectory(categoriesQuery.data ?? []);
  const department = directory.departments.find((item) => item.slug === departmentSlug) ?? null;
  const [listingKind, setListingKind] = useState<'all' | ListingKind>('all');
  useEffect(() => {
    setListingKind('all');
  }, [departmentSlug]);
  const scopeIds = department ? department.productCategoryIds : null;
  const emptyScope = !!scopeIds && scopeIds.length === 0;
  const browsingDirectory = showDirectory && !department;
  const listingType = department && listingKind !== 'all' ? (listingKind === 'products' ? 'product' : 'service') : undefined;
  const searchQuery = useMarketplaceSearch(query, { departmentId: department?.id || undefined, listingType });
  const categoryHits = searchQuery.categories;

  const itemsQuery = useQuery({
    queryKey: ['shop-items', scopeIds?.slice().sort().join(',') ?? 'all', department ? 'department' : feed],
    queryFn: () => getShopFeed(scopeIds),
    enabled: !browsingDirectory && !emptyScope && (!!department || feed !== 'following'),
  });

  const cardWidth = Math.floor((width - Spacing.three * 2 - Spacing.three) / 2);
  const needle = query.trim().toLowerCase();
  const categoryText = categorySearchText(categoriesQuery.data ?? []);
  // Sponsored: one ad banner + up to 4 boosted listings (search only shows relevant boosts).
  const sponsoredPlacement = needle ? 'search' : 'shop';
  const sponsored = useSponsored(sponsoredPlacement, { ads: 1, boosts: 4 });
  const products = marketplaceItems({
    remote: searchQuery.data?.items, cached: itemsQuery.data, query,
    useLocal: searchQuery.useLocalItems, scopeIds, listingType, categoryText,
  });

  function openDepartment(slug: string) {
    setShowDirectory(false);
    setDepartmentSlug(slug);
    router.setParams({ view: '', department: slug, category: '' });
  }

  function openCategory(categoryId: string) {
    router.push(`/shop/category/${categoryId}` as never);
  }

  function openDirectory() {
    setShowDirectory(true);
    setDepartmentSlug(null);
    router.setParams({ view: 'directory', department: '', category: '' });
  }

  function openGallery() {
    setShowDirectory(false);
    setDepartmentSlug(null);
    router.setParams({ view: '', department: '', category: '' });
  }

  const title = department ? department.name : browsingDirectory ? 'Categories' : 'Shop';
  const galleryTitle = department ? `Popular in ${department.name}` : feed === 'new' ? 'New listings' : feed === 'popular' ? 'Popular' : 'Recommended for you';

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={itemsQuery.isFetching && !browsingDirectory} onRefresh={() => { categoriesQuery.refetch(); if (!browsingDirectory) itemsQuery.refetch(); if (query.trim()) searchQuery.refetch(); }} />}
        >
          {browsingDirectory ? (
            <DepartmentDirectory
              departments={directory.departments}
              featured={featuredEntries(categoriesQuery.data ?? [])}
              onOpenDepartment={openDepartment}
              onOpenCategory={openCategory}
              onProducts={openGallery}
            />

          ) : (
            <>
              <View style={styles.searchRow}>
                <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
                  <Ionicons name="search" size={18} color={Palette.blue} />
                  <TextInput
                    maxLength={200}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search products, categories, sellers"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.searchInput, { color: theme.text }]}
                  />
                </View>
                <Pressable onPress={openDirectory} style={styles.categoriesButton} accessibilityLabel="Categories">
                  <Ionicons name="grid" size={16} color={Palette.blueDark} />
                  <ThemedText type="smallBold" style={styles.categoriesLabel}>Categories</ThemedText>
                </Pressable>
              </View>

              {searchQuery.degraded ? <ThemedText type="small">Some results are unavailable. Pull to retry.</ThemedText> : null}
              {categoryHits.length ? (
                <View style={styles.departmentList}>
                  <ThemedText type="smallBold">Matching categories</ThemedText>
                  {categoryHits.map((entry) => (
                      <Pressable
                        key={`${entry.kind}-${entry.id}`}
                        onPress={() => (entry.kind === 'department' ? openDepartment(entry.departmentSlug) : openCategory(entry.id))}
                        style={[styles.departmentRow, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
                      >
                        <CatalogueThumb imageUrl={entry.imageUrl} icon={entry.icon} tint={entry.tint} ink={entry.ink} size={48} radius={16} iconSize={22} />
                        <View style={styles.departmentCopy}>
                          <ThemedText type="smallBold">{entry.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">{entry.matchType === 'fuzzy' ? 'Suggested category · ' : ''}{entry.kind === 'department' ? 'Department' : entry.departmentName}</ThemedText>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                      </Pressable>
                  ))}
                </View>
              ) : null}

              {department ? (
                <DepartmentPage
                  department={department}
                  listingKind={listingKind}
                  onChangeKind={setListingKind}
                  onSelectCategory={openCategory}
                />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  {FEEDS.map((item) => (
                    <FilterChip key={item.id} label={item.label} selected={feed === item.id} onPress={() => setFeed(item.id)} />
                  ))}
                </ScrollView>
              )}

              {sponsored.data?.ads?.[0] && !browsingDirectory ? <SponsoredAdCard ad={sponsored.data.ads[0]} placement={sponsoredPlacement} /> : null}
              <ThemedText type="smallBold">{galleryTitle}</ThemedText>
              {feed === 'popular' && !department ? (
                <ThemedText type="small" themeColor="textSecondary">Latest live listings until a popularity ranking is available.</ThemedText>
              ) : null}
              {feed === 'foryou' && !department ? (
                <ThemedText type="small" themeColor="textSecondary">Latest live listings from every seller.</ThemedText>
              ) : null}

              {feed === 'following' && !department ? (
                <ThemedText style={styles.empty}>Following is not available yet. Sellers you follow will show up here.</ThemedText>
              ) : (needle ? searchQuery.isSearching : itemsQuery.isLoading) ? (
                <ActivityIndicator size="large" style={styles.loading} />
              ) : itemsQuery.isError && (!needle || searchQuery.isError) && !products.length ? (
                <ThemedText style={styles.empty}>Couldn&apos;t load the shop. Pull to retry.</ThemedText>
              ) : products.length ? (
                <View style={styles.grid}>
                  {boostedFor(sponsored.data?.boosted, products, needle, scopeIds).map((boost) => (
                    <ListingCard key={`boost-${boost.campaign_id}`} item={boost.listing} width={cardWidth} sponsored={{ campaignId: boost.campaign_id, placement: sponsoredPlacement }} />
                  ))}
                  {products.map((item) => (
                    <ListingCard key={item.id} item={item} width={cardWidth} />
                  ))}
                </View>
              ) : (
                <ThemedText style={styles.empty}>{needle ? (searchQuery.degraded ? 'Search is temporarily unavailable. Pull to retry.' : 'No listings match that search.') : 'No products in this category yet.'}</ThemedText>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <FloatingCart />
    </ThemedView>
  );
}

/** Boosted listings that fit the current view, shown before (not duplicated in) the regular grid. */
function boostedFor(boosted: { campaign_id: string; listing: CatalogueItem }[] | undefined, products: CatalogueItem[], needle: string, scopeIds: string[] | null) {
  return (boosted ?? []).filter(({ listing }) =>
    (!scopeIds || scopeIds.includes(listing.category_id || ''))
    && (!needle || [listing.title, listing.description].some((text) => (text || '').toLowerCase().includes(needle))));
}

function paramValue(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : null;
}

function DepartmentDirectory({
  departments,
  featured,
  onOpenDepartment,
  onOpenCategory,
  onProducts,
}: {
  departments: ShopDepartment[];
  featured: ReturnType<typeof featuredEntries>;
  onOpenDepartment: (slug: string) => void;
  onOpenCategory: (categoryId: string) => void;
  onProducts: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.departmentList}>
      <Pressable onPress={onProducts} style={styles.backRow}>
        <Ionicons name="chevron-back" size={16} color={Palette.blue} />
        <ThemedText type="smallBold" style={styles.backText}>Products</ThemedText>
      </Pressable>
      <ThemedText type="smallBold">Featured</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.iconRow}>
        {featured.map((link) => (
          <CategoryTile
            key={link.key}
            label={link.label}
            icon={link.icon}
            tint={link.tint}
            ink={link.ink}
            imageUrl={link.imageUrl}
            selected={false}
            onPress={() => (link.categoryId ? onOpenCategory(link.categoryId) : onOpenDepartment(link.departmentSlug))}
          />
        ))}
      </ScrollView>
      <ThemedText type="smallBold">All departments</ThemedText>
      {departments.map((item) => (
        <Pressable key={item.slug} onPress={() => onOpenDepartment(item.slug)} style={[styles.departmentRow, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <CatalogueThumb imageUrl={item.imageUrl} icon={item.icon} tint={item.tint} ink={item.ink} size={48} radius={16} iconSize={24} />
          <View style={styles.departmentCopy}>
            <ThemedText type="smallBold">{item.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{item.categories.length} categories</ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </Pressable>
      ))}
    </View>
  );
}

const LISTING_KINDS: { id: 'all' | ListingKind; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'apps' },
  { id: 'products', label: 'Products', icon: 'bag-handle' },
  { id: 'services', label: 'Services', icon: 'people' },
];

function DepartmentPage({
  department,
  listingKind,
  onChangeKind,
  onSelectCategory,
}: {
  department: ShopDepartment;
  listingKind: 'all' | ListingKind;
  onChangeKind: (kind: 'all' | ListingKind) => void;
  onSelectCategory: (categoryId: string) => void;
}) {
  const sections = department.sections.filter((section) => listingKind === 'all' || !section.kind || section.kind === listingKind);
  return (
    <View style={styles.departmentList}>
      <DepartmentBanner department={department} />
      {hasListingKinds(department) ? (
        <View style={styles.kindRow}>
          {LISTING_KINDS.map((kind) => (
            <FilterChip key={kind.id} label={kind.label} icon={kind.icon} selected={listingKind === kind.id} onPress={() => onChangeKind(kind.id)} />
          ))}
        </View>
      ) : null}
      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <ThemedText type="smallBold">{section.title}</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.iconRow}>
            {section.categories.map((item) => (
              <CategoryTile
                key={item.id}
                label={item.name}
                icon={item.icon}
                tint={item.tint}
                ink={item.ink}
                imageUrl={item.image_url}
                selected={false}
                onPress={() => onSelectCategory(item.id)}
              />
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function DepartmentBanner({ department }: { department: ShopDepartment }) {
  return (
    <CatalogueBanner
      imageUrl={department.imageUrl}
      title={department.bannerTitle || department.name}
      subtitle={department.bannerSubtitle}
      icon={department.icon}
      tint={department.tint}
      ink={department.ink}
    />
  );
}

function CategoryTile({ label, icon, tint, ink, imageUrl, selected, onPress }: { label: string; icon: string; tint: string; ink: string; imageUrl?: string | null; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.categoryTile}>
      <CatalogueThumb
        imageUrl={imageUrl}
        icon={icon}
        tint={tint}
        ink={ink}
        size={64}
        radius={20}
        iconSize={26}
        style={[styles.categoryIcon, selected && { borderColor: ink }]}
      />
      <ThemedText type="smallBold" numberOfLines={2} style={[styles.categoryLabel, selected && { color: ink }]}>{label}</ThemedText>
    </Pressable>
  );
}

function FilterChip({ label, icon, selected, onPress }: { label: string; icon?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      {icon ? <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={14} color={selected ? Palette.white : Palette.blueDark} /> : null}
      <ThemedText type="smallBold" style={{ color: selected ? Palette.white : Palette.blueDark }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  searchBar: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Spacing.two },
  categoriesButton: { minHeight: 46, borderRadius: 14, paddingHorizontal: 10, backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center', gap: 2 },
  categoriesLabel: { color: Palette.blueDark, fontSize: 11 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + FLOATING_CART_SPACE },
  filters: { gap: Spacing.two, paddingVertical: Spacing.one },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Palette.blueSoft },
  chipSelected: { backgroundColor: Palette.blue },
  departmentList: { gap: Spacing.two },
  section: { gap: Spacing.one },
  kindRow: { flexDirection: 'row', gap: Spacing.two },
  departmentRow: { minHeight: 64, borderRadius: 16, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconRow: { gap: Spacing.three, paddingVertical: Spacing.one, paddingRight: Spacing.two },
  departmentIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  departmentCopy: { flex: 1, gap: 2 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  backText: { color: Palette.blue },
  hits: { gap: Spacing.two },
  hitRow: { minHeight: 58, borderRadius: 14, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  categoryTile: { width: 84, alignItems: 'center', gap: 8 },
  categoryIcon: { borderWidth: 2, borderColor: 'transparent' },
  categoryLabel: { fontSize: 12, lineHeight: 15, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  loading: { marginTop: Spacing.five },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
