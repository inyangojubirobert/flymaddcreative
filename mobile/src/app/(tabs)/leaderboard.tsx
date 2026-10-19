import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getLeaderboard } from '@/api/gifts';

// Recognition boards replace the old paid-vote leaderboard: appreciation from
// Dream Coin gifts and verified seller delivery, kept separate. Non-cash only.

type Board = 'most_appreciated' | 'reliable_merchants';

const BOARDS: [Board, string][] = [['most_appreciated', 'Most appreciated'], ['reliable_merchants', 'Reliable merchants']];

export default function LeaderboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [board, setBoard] = useState<Board>('most_appreciated');

  const boardQuery = useQuery({
    queryKey: ['reward-board', board],
    queryFn: () => getLeaderboard(board),
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons name="ribbon" size={24} color={Palette.yellowInk} />
            </View>
            <View style={styles.titleCopy}>
              <ThemedText type="title" style={styles.title}>Recognition</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Creators and sellers the community appreciates. Recognition only, no prizes.</ThemedText>
            </View>
          </View>

          <View style={styles.tabs}>
            {BOARDS.map(([key, label]) => (
              <Pressable key={key} onPress={() => setBoard(key)} style={[styles.tab, board === key && styles.tabActive]}>
                <ThemedText type="smallBold" style={board === key ? styles.tabActiveText : undefined}>{label}</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        {boardQuery.isLoading ? (
          <ActivityIndicator size="large" color={Palette.blue} style={styles.loading} />
        ) : boardQuery.isError ? (
          <Pressable onPress={() => boardQuery.refetch()} style={styles.errorCard}>
            <Ionicons name="refresh" size={22} color={Palette.red} />
            <ThemedText style={styles.error}>Couldn&apos;t load recognition. Tap to retry.</ThemedText>
          </Pressable>
        ) : (
          <FlatList
            data={boardQuery.data?.entries ?? []}
            keyExtractor={(item) => item.username}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={boardQuery.isFetching} onRefresh={() => boardQuery.refetch()} colors={[Palette.blue]} />
            }
            ListHeaderComponent={boardQuery.data?.notice ? (
              <ThemedText type="small" themeColor="textSecondary">{boardQuery.data.notice}</ThemedText>
            ) : null}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Ionicons name="gift-outline" size={28} color={Palette.slate} />
                <ThemedText type="smallBold">No one here yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Send a gift from any profile to appreciate a creator.</ThemedText>
              </View>
            }
            renderItem={({ item, index }) => {
              const podium = index < 3;
              const rankBackground = index === 0 ? Palette.yellowSoft : index === 1 ? Palette.ash : index === 2 ? '#FFEDD5' : Palette.blueSoft;
              const rankColor = index === 0 ? Palette.yellowInk : index === 1 ? Palette.slateDark : index === 2 ? '#9A3412' : Palette.blueDark;
              return (
                <Pressable
                  onPress={() => router.push(`/gifts/recognition/${item.username}` as never)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={[styles.rankBadge, { backgroundColor: rankBackground }]}>
                    {podium ? <Ionicons name="ribbon" size={15} color={rankColor} /> : null}
                    <ThemedText type="smallBold" style={{ color: rankColor }}>#{item.rank}</ThemedText>
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText type="default" style={styles.personName}>{item.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">@{item.username}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.metric}>
                    {board === 'reliable_merchants'
                      ? `${item.confirmed_sales ?? 0} delivered · ${item.reliability ?? 0}%`
                      : `${(item.recognition_points ?? 0).toLocaleString()} pts · ${item.supporters ?? 0} supporters`}
                  </ThemedText>
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
  tabs: { flexDirection: 'row', gap: Spacing.two },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Palette.ashSoft },
  tabActive: { backgroundColor: Palette.blue },
  tabActiveText: { color: Palette.white },
  listContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.one, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 12, gap: 12, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  rowPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  rankBadge: { minWidth: 48, height: 38, paddingHorizontal: 7, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  rowText: { flex: 1, gap: 1 },
  personName: { fontWeight: '700' },
  metric: { fontSize: 12, textAlign: 'right', maxWidth: 120 },
  loading: { marginTop: Spacing.six },
  errorCard: { margin: Spacing.three, padding: Spacing.three, borderRadius: 16, backgroundColor: Palette.redSoft, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  error: { color: '#991B1B', flex: 1 },
  emptyCard: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
});
