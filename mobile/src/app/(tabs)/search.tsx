import { useState } from 'react';
import { FlatList, StyleSheet, TextInput, Pressable, ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { searchParticipants } from '@/api/participants';

export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const searchQuery = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchParticipants(query),
    enabled: query.trim().length > 0,
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="search" size={24} color={Palette.blue} />
          </View>
          <View style={styles.headerCopy}>
            <ThemedText type="title" style={styles.title}>Discover</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Find a creator and support their dream.</ThemedText>
          </View>
        </View>

        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <Ionicons name="search-outline" size={20} color={Palette.blue} />
          <TextInput
            placeholder="Name, username, or voting code"
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

        {searchQuery.isFetching && <ActivityIndicator style={styles.loading} />}

        <FlatList
          data={searchQuery.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
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
              <View style={styles.voteCount}>
                <Ionicons name="heart" size={14} color={Palette.yellow} />
                <ThemedText type="smallBold" style={styles.voteText}>{item.total_votes.toLocaleString()}</ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </Pressable>
          )}
          ListEmptyComponent={
            query.trim() && !searchQuery.isFetching ? (
              <View style={styles.emptyCard}>
                <Ionicons name="people-outline" size={32} color={Palette.slate} />
                <ThemedText type="smallBold">No creators found</ThemedText>
                <ThemedText type="small" style={styles.empty} themeColor="textSecondary">Check the spelling or try a voting code.</ThemedText>
              </View>
            ) : (
              <View style={styles.promptCard}>
                <View style={styles.promptIcon}>
                  <Ionicons name="sparkles" size={25} color={Palette.yellowInk} />
                </View>
                <ThemedText type="smallBold" style={styles.promptTitle}>Start discovering</ThemedText>
                <ThemedText type="small" style={styles.empty} themeColor="textSecondary">Search by name, @username, or a creator&apos;s voting code.</ThemedText>
              </View>
            )
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
  list: { gap: Spacing.two, paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 12, gap: 10, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  personIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  personName: { fontWeight: '700' },
  voteCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteText: { color: Palette.blue },
  pressed: { opacity: 0.72 },
  emptyCard: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  promptCard: { marginTop: Spacing.four, backgroundColor: Palette.yellowSoft, borderColor: '#FDE68A', borderWidth: 1, borderRadius: 20, minHeight: 190, alignItems: 'center', justifyContent: 'center', gap: Spacing.one, padding: Spacing.four },
  promptIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  promptTitle: { color: Palette.yellowInk, fontSize: 16 },
  empty: { textAlign: 'center', maxWidth: 280 },
});
