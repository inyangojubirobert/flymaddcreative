import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getLeaderboard, getRewardProgress, type ProgramProgress } from '@/api/gifts';

// Marketplace recognition: programme progress from verified activity, awards
// received, and two separate leaderboards (appreciation vs. verified seller
// performance). All rewards are non-cash.

const STATUS: Record<ProgramProgress['status'], [string, string, string]> = {
  eligible: ['Eligible', '#ECFCCB', '#3F6212'],
  in_progress: ['In progress', Palette.blueSoft, Palette.blueDark],
  not_tracked: ['Coming soon', Palette.ashSoft, Palette.slate],
  admin_review: ['Awarded by the team', Palette.yellowSoft, Palette.yellowInk],
};

const fmt = (metric: string | null, value: number | null) =>
  value === null ? '–' : metric === 'delivery_reliability' ? `${Math.round(value * 100)}%` : value.toLocaleString();

export default function RewardsScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const [board, setBoard] = useState<'most_appreciated' | 'reliable_merchants'>('reliable_merchants');
  const progressQuery = useQuery({ queryKey: ['reward-progress'], queryFn: () => getRewardProgress(token!), enabled: !!token });
  const boardQuery = useQuery({ queryKey: ['reward-board', board], queryFn: () => getLeaderboard(board) });
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={progressQuery.isFetching} onRefresh={() => { void progressQuery.refetch(); void boardQuery.refetch(); }} colors={[Palette.blue]} />}
        >
          <ThemedText type="small" themeColor="textSecondary">
            Recognition for great selling, reliable delivery and a helpful community. Rewards are badges, features and platform benefits - never cash prizes.
          </ThemedText>

          {progressQuery.data?.awards.length ? (
            <View style={[styles.section, card]}>
              <ThemedText type="smallBold">Your awards</ThemedText>
              {progressQuery.data.awards.map((a) => (
                <ThemedText key={a.id} type="small">🏅 {a.title} · {a.period}</ThemedText>
              ))}
            </View>
          ) : null}

          <ThemedText type="smallBold" style={styles.sectionLabel}>PROGRAMMES</ThemedText>
          {progressQuery.isLoading ? <ActivityIndicator /> : (progressQuery.data?.progress ?? []).map((p) => {
            const [label, bg, ink] = STATUS[p.status];
            const ratio = p.value !== null && p.target ? Math.min(1, p.value / p.target) : 0;
            return (
              <View key={p.program.id} style={[styles.section, card]}>
                <View style={styles.headRow}>
                  <ThemedText type="smallBold" style={styles.flex}>{p.program.name}</ThemedText>
                  <View style={[styles.pill, { backgroundColor: bg }]}><ThemedText type="smallBold" style={{ color: ink, fontSize: 11 }}>{label}</ThemedText></View>
                </View>
                {p.program.description ? <ThemedText type="small" themeColor="textSecondary">{p.program.description}</ThemedText> : null}
                {p.status === 'eligible' || p.status === 'in_progress' ? (
                  <>
                    <View style={styles.track}><View style={[styles.fill, { width: `${ratio * 100}%` }]} /></View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {fmt(p.metric, p.value)} of {fmt(p.metric, p.target)} · last {p.window_days} days{p.note ? ` · ${p.note}` : ''}
                    </ThemedText>
                  </>
                ) : null}
                {p.program.reward_label ? <ThemedText type="small">Reward: {p.program.reward_label}</ThemedText> : null}
              </View>
            );
          })}

          <ThemedText type="smallBold" style={styles.sectionLabel}>LEADERBOARDS</ThemedText>
          <View style={styles.tabs}>
            {([['reliable_merchants', 'Reliable merchants'], ['most_appreciated', 'Most appreciated']] as const).map(([key, title]) => (
              <Pressable key={key} onPress={() => setBoard(key)} style={[styles.tab, board === key && styles.tabActive]}>
                <ThemedText type="smallBold" style={board === key ? styles.tabActiveText : undefined}>{title}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={[styles.section, card]}>
            {boardQuery.data?.notice ? <ThemedText type="small" themeColor="textSecondary">{boardQuery.data.notice}</ThemedText> : null}
            {boardQuery.isLoading ? <ActivityIndicator /> : boardQuery.data?.entries.length ? boardQuery.data.entries.map((e) => (
              <Pressable key={e.username} onPress={() => router.push(`/gifts/recognition/${e.username}` as never)} style={styles.entry}>
                <ThemedText type="smallBold" style={styles.rank}>{e.rank}</ThemedText>
                <View style={styles.flex}>
                  <ThemedText type="smallBold">{e.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">@{e.username}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {board === 'reliable_merchants'
                    ? `${e.confirmed_sales} delivered · ${e.reliability}%`
                    : `${(e.recognition_points ?? 0).toLocaleString()} pts · ${e.supporters} supporters`}
                </ThemedText>
              </Pressable>
            )) : <ThemedText type="small" themeColor="textSecondary">No one here yet.</ThemedText>}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  sectionLabel: { color: Palette.slate, letterSpacing: 0.6, marginBottom: -Spacing.two },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  track: { height: 8, borderRadius: 4, backgroundColor: Palette.ash, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: Palette.blue },
  tabs: { flexDirection: 'row', gap: Spacing.two },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: Palette.ashSoft },
  tabActive: { backgroundColor: Palette.blue },
  tabActiveText: { color: Palette.white },
  entry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 4 },
  rank: { width: 24, textAlign: 'center' },
});
