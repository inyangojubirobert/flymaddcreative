import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GiftArt } from '@/components/gift-art';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getRecognition } from '@/api/gifts';

// A seller's appreciation: gifts received, supporters, badges and monthly
// statistics. Recognition points are not money or a withdrawable balance.

export default function RecognitionScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { participant } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const query = useQuery({ queryKey: ['recognition', username], queryFn: () => getRecognition(username), enabled: !!username });
  const data = query.data;
  const isMe = participant?.username?.toLowerCase() === String(username).toLowerCase();
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: isMe ? 'My recognition' : 'Appreciation' }} />
      <SafeAreaView edges={['bottom']} style={styles.container}>
        {query.isLoading ? <ActivityIndicator style={styles.loading} /> : !data ? (
          <ThemedText style={styles.loading}>Not found.</ThemedText>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} colors={[Palette.blue]} />}
          >
            <ThemedText type="subtitle">{data.seller.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">@{data.seller.username}</ThemedText>

            <View style={styles.stats}>
              <Stat label="Recognition" value={data.recognition_points} />
              <Stat label="Gifts" value={data.gifts_received} />
              <Stat label="Supporters" value={data.supporters} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">Recognition points show appreciation only. They are not money, cannot be withdrawn, and never decide prizes.</ThemedText>

            {data.badges.length ? (
              <View style={styles.badges}>
                {data.badges.map((b) => <View key={b.id} style={styles.badge}><ThemedText type="smallBold" style={styles.badgeText}>🏅 {b.label}</ThemedText></View>)}
              </View>
            ) : null}

            {!isMe ? (
              <Pressable onPress={() => router.push({ pathname: '/gifts/send', params: { username: data.seller.username } } as never)} style={styles.sendButton}>
                <ThemedText style={styles.sendText}>🎁 Send a gift</ThemedText>
              </Pressable>
            ) : null}

            {data.recent_gifts.length ? (
              <View style={[styles.section, card]}>
                <ThemedText type="smallBold">Recent gifts</ThemedText>
                <View style={styles.giftRow}>
                  {data.recent_gifts.map((g) => (
                    <View key={g.name} style={styles.giftCount}>
                      <GiftArt gift={g} size={30} />
                      <ThemedText type="small">× {g.count}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {data.monthly.length ? (
              <View style={[styles.section, card]}>
                <ThemedText type="smallBold">Monthly appreciation</ThemedText>
                {data.monthly.map((m) => (
                  <View key={m.month} style={styles.row}>
                    <ThemedText type="small">{m.month}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{m.gifts} gifts · {m.supporters} supporters · {m.points.toLocaleString()} pts</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={[styles.section, card]}>
              <ThemedText type="smallBold">Supporters</ThemedText>
              {data.recent.length ? data.recent.map((g) => (
                <View key={g.id} style={styles.supporter}>
                  <GiftArt gift={g.gift} size={28} />
                  <View style={styles.supporterText}>
                    <ThemedText type="smallBold">
                      {g.from ? `@${g.from.username}` : 'A supporter'} sent {g.quantity > 1 ? `${g.quantity} × ` : ''}{g.gift.name}
                    </ThemedText>
                    {g.message ? <ThemedText type="small">&ldquo;{g.message}&rdquo;</ThemedText> : null}
                    <ThemedText type="small" themeColor="textSecondary">
                      {new Date(g.created_at).toLocaleDateString()}{g.verified_buyer ? ' · ✓ verified purchase' : ''}
                    </ThemedText>
                  </View>
                </View>
              )) : <ThemedText type="small" themeColor="textSecondary">No gifts yet.</ThemedText>}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <ThemedText style={styles.statValue}>{value.toLocaleString()}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, borderWidth: 1, borderRadius: 14, padding: Spacing.two, alignItems: 'center' },
  statValue: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: Palette.yellowSoft },
  badgeText: { color: Palette.yellowInk },
  sendButton: { backgroundColor: Palette.blue, borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center' },
  sendText: { color: Palette.white, fontWeight: '700' },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  giftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  giftCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  supporter: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  supporterText: { flex: 1, gap: 1 },
});
