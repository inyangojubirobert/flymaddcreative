import { useState } from 'react';
import { FlatList, StyleSheet, TextInput, Pressable, ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { CatalogueThumb } from '@/components/catalogue-visuals';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMarketplaceSearch } from '@/hooks/use-marketplace-search';

export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const searchQuery = useMarketplaceSearch(query);
  const participants = searchQuery.data?.participants ?? [];
  const products = searchQuery.data?.items ?? [];
  const categoryHits = searchQuery.categories;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="search" size={24} color={Palette.blue} />
          </View>
          <View style={styles.headerCopy}>
            <ThemedText type="title" style={styles.title}>Discover</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Find creators, products, services, and categories.</ThemedText>
          </View>
        </View>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="search-outline" size={20} color={Palette.blue} />
          <TextInput
            placeholder="Creator, product, service, or category"
            maxLength={200}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {searchQuery.isSearching && <ActivityIndicator style={styles.loading} />}
        {searchQuery.degraded ? <Pressable onPress={() => searchQuery.refetch()} accessibilityRole="button"><ThemedText type="small" style={styles.sectionTitle}>Some search results are unavailable. Tap to retry.</ThemedText></Pressable> : null}

        <FlatList
          data={participants}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<>

            {categoryHits.length ? (
              <View style={styles.section}>
                <ThemedText type="smallBold">Categories &amp; departments</ThemedText>
                {categoryHits.map((entry) => (
                  <Pressable
                    key={`${entry.kind}-${entry.id}`}
                    onPress={() => {
                      if (entry.kind === 'department') router.push(`/shop?department=${entry.departmentSlug}` as never);
                      else router.push(`/shop/category/${entry.id}` as never);
                    }}
                    style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
                  >
                    <CatalogueThumb imageUrl={entry.imageUrl} icon={entry.icon} tint={entry.tint} ink={entry.ink} size={42} radius={14} iconSize={20} />
                    <View style={styles.rowText}>
                      <ThemedText type="default" style={styles.personName}>{entry.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{entry.matchType === 'fuzzy' ? 'Suggested category · ' : ''}{entry.kind === 'department' ? 'Department' : entry.departmentName}</ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {products.length ? (
              <View style={styles.section}>
                <ThemedText type="smallBold">Products &amp; services</ThemedText>
                {products.map((product) => (
                  <Pressable
                    key={product.id}
                    onPress={() => router.push(`/catalogue/item/${product.id}` as never)}
                    style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
                  >
                    <CatalogueThumb imageUrl={product.images?.[0]} icon="pricetag" tint="#DBEAFE" ink="#1E3A8A" size={42} radius={14} iconSize={20} />
                    <View style={styles.rowText}>
                      <ThemedText type="default" style={styles.personName}>{product.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        ${Number(product.price_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · @{product.seller_username}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {query.trim() ? <ThemedText type="smallBold" style={styles.sectionTitle}>Creators</ThemedText> : null}
          </>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/profile/${item.username}`)}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }, pressed && styles.pressed]}
            >
              <View style={styles.personIcon}>
                <Ionicons name="person" size={20} color={Palette.blueDark} />
              </View>
              <View style={styles.rowText}>
                <ThemedText type="default" style={styles.personName}>{item.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">@{item.username}</ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
          ListEmptyComponent={
            query.trim() && !searchQuery.isSearching ? (
              categoryHits.length || products.length ? null : (
              <View style={styles.emptyCard}>
                <Ionicons name="people-outline" size={32} color={Palette.slate} />
                <ThemedText type="smallBold">{searchQuery.degraded ? 'Search is temporarily unavailable' : 'No matches found'}</ThemedText>
                <ThemedText type="small" style={styles.empty} themeColor="textSecondary">Try a creator name, product, service, or category.</ThemedText>
              </View>
              )
            ) : !query.trim() ? (
              <View style={styles.promptCard}>
                <View style={styles.promptIcon}>
                  <Ionicons name="sparkles" size={25} color={Palette.yellowInk} />
                </View>
                <ThemedText type="smallBold" style={styles.promptTitle}>Start discovering</ThemedText>
                <ThemedText type="small" style={styles.empty} themeColor="textSecondary">Search creators, or shop categories like Shoes and Web Development.</ThemedText>
              </View>
            ) : null
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.two, marginBottom: Spacing.three },
  headerIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, gap: Spacing.half },
  title: { fontSize: 28, lineHeight: 34 },
  searchBox: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { flex: 1, paddingVertical: Spacing.two, fontSize: 15 },
  loading: { marginTop: Spacing.four },
  section: { gap: Spacing.two, marginTop: Spacing.three },
  sectionTitle: { marginBottom: Spacing.one },
  list: { gap: Spacing.two, paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 12, gap: 10, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  personIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  personName: { fontWeight: '700' },
  pressed: { opacity: 0.72 },
  emptyCard: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  promptCard: { marginTop: Spacing.four, backgroundColor: Palette.yellowSoft, borderColor: '#FDE68A', borderWidth: 1, borderRadius: 20, minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: Spacing.one, padding: Spacing.four },
  promptIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  promptTitle: { color: Palette.yellowInk, fontSize: 16 },
  empty: { textAlign: 'center', maxWidth: 280 },
});
