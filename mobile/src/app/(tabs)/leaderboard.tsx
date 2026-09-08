import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getLeaderboard } from '@/api/participants';

export default function LeaderboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [search, setSearch] = useState('');

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', 'full'],
    queryFn: () => getLeaderboard(100),
  });

  const participants = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return leaderboardQuery.data ?? [];
    return (leaderboardQuery.data ?? []).filter((participant) =>
      participant.name.toLowerCase().includes(normalized)
      || participant.username.toLowerCase().includes(normalized)
      || participant.user_code?.toLowerCase().includes(normalized),
    );
  }, [leaderboardQuery.data, search]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons name="trophy" size={24} color={Palette.yellowInk} />
            </View>
            <View style={styles.titleCopy}>
              <ThemedText type="title" style={styles.title}>Leaderboard</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Find creators and see who is building momentum.</ThemedText>
            </View>
          </View>

          <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
            <Ionicons name="search" size={20} color={Palette.blue} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, username, or code"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.text }]}
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {leaderboardQuery.isLoading ? (
          <ActivityIndicator size="large" color={Palette.blue} style={styles.loading} />
        ) : leaderboardQuery.isError ? (
          <Pressable onPress={() => leaderboardQuery.refetch()} style={styles.errorCard}>
            <Ionicons name="refresh" size={22} color={Palette.red} />
            <ThemedText style={styles.error}>Couldn&apos;t load the leaderboard. Tap to retry.</ThemedText>
          </Pressable>
        ) : (
          <FlatList
            data={participants}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={leaderboardQuery.isFetching} onRefresh={() => leaderboardQuery.refetch()} colors={[Palette.blue]} />
            }
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Ionicons name="search-outline" size={28} color={Palette.slate} />
                <ThemedText type="smallBold">No matching creators</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Try another name, username, or voting code.</ThemedText>
              </View>
            }
            renderItem={({ item, index }) => {
              const podium = index < 3;
              const rankBackground = index === 0 ? Palette.yellowSoft : index === 1 ? Palette.ash : index === 2 ? '#FFEDD5' : Palette.blueSoft;
              const rankColor = index === 0 ? Palette.yellowInk : index === 1 ? Palette.slateDark : index === 2 ? '#9A3412' : Palette.blueDark;
              return (
                <Pressable
                  onPress={() => router.push(`/profile/${item.username}` as never)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={[styles.rankBadge, { backgroundColor: rankBackground }]}>
                    {podium ? <Ionicons name="trophy" size={15} color={rankColor} /> : null}
                    <ThemedText type="smallBold" style={{ color: rankColor }}>#{index + 1}</ThemedText>
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText type="default" style={styles.personName}>{item.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">@{item.username}</ThemedText>
                  </View>
                  <View style={styles.votesWrap}>
                    <ThemedText type="smallBold" style={styles.votes}>{item.total_votes.toLocaleString()}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.votesLabel}>votes</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  titleIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: Palette.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  titleCopy: { flex: 1, gap: Spacing.half },
  title: { fontSize: 27, lineHeight: 32 },
  searchBox: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: Spacing.three, gap: Spacing.two },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: Spacing.two },
  listContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 12, gap: 12, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  rankBadge: { minWidth: 48, height: 38, paddingHorizontal: 7, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  rowText: { flex: 1, gap: 1 },
  personName: { fontWeight: '700' },
  votesWrap: { alignItems: 'flex-end' },
  votes: { color: Palette.blue },
  votesLabel: { fontSize: 11, lineHeight: 14 },
  loading: { marginTop: Spacing.six },
  errorCard: { margin: Spacing.three, padding: Spacing.three, borderRadius: 16, backgroundColor: Palette.redSoft, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  error: { color: '#991B1B', flex: 1 },
  emptyCard: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
});
