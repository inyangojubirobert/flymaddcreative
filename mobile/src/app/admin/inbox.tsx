import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useAdmin } from '@/contexts/AdminContext';
import { useTheme } from '@/hooks/use-theme';
import { type Conversation, waitedFor } from '@/lib/admin-shared';

// Admin inbox: one conversation per participant. Questions and withdrawal
// requests both land here (withdrawal requests post themselves).

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'handled', label: 'Handled' },
  { key: 'all', label: 'All' },
] as const;

export default function AdminInboxScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { adminFetch } = useAdmin();
  const [filter, setFilter] = useState<'open' | 'handled' | 'all'>('open');
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminFetch<{ conversations: Conversation[] }>(`/api/admin/inbox?status=${filter}`);
      setRows(d.conversations); setError(null);
    } catch (e) {
      setError((e as Error).message || 'Could not load the inbox');
    } finally { setLoading(false); }
  }, [adminFetch, filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Admin inbox' }} />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => { setRows(null); setFilter(f.key); }} style={[styles.chip, filter === f.key && styles.chipOn]}>
            <ThemedText type="smallBold" style={filter === f.key ? styles.chipTextOn : undefined}>{f.label}</ThemedText>
          </Pressable>
        ))}
      </View>
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      {rows === null ? <ActivityIndicator style={styles.loading} color={Palette.blue} /> : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.participant_id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<ThemedText themeColor="textSecondary" style={styles.empty}>{filter === 'open' ? 'Nothing waiting. 🎉' : 'No conversations.'}</ThemedText>}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/admin/thread', params: { participantId: c.participant_id } } as never)}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement }, c.ringing && styles.ringing, pressed && styles.pressed]}
            >
              <Ionicons name={c.kind === 'withdrawal' ? 'arrow-up-circle' : 'chatbubble-ellipses'} size={22} color={c.kind === 'withdrawal' ? Palette.yellow : Palette.blue} />
              <View style={styles.flex}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {c.participant ? `@${c.participant.username}` : 'Participant'}{c.participant?.name ? ` · ${c.participant.name}` : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {c.last_message.sender_type === 'participant' ? '' : 'You: '}{c.last_message.body}
                </ThemedText>
                <ThemedText type="small" style={c.waiting ? styles.waiting : styles.muted}>
                  {c.label} · {c.waiting ? `waiting ${waitedFor(c.waiting_since)}` : c.status === 'open' ? 'replied' : 'handled'}
                  {c.ringing ? ' · ringing' : ''}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Palette.slate} />
            </Pressable>
          )}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  filters: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.two },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: Palette.blue },
  chipOn: { backgroundColor: Palette.blue },
  chipTextOn: { color: '#fff' },
  list: { padding: Spacing.three, paddingTop: 0, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.three },
  ringing: { borderWidth: 2, borderColor: Palette.red },
  pressed: { opacity: 0.7 },
  waiting: { color: Palette.red, fontWeight: '700' },
  muted: { color: Palette.slate },
  loading: { marginTop: 40 },
  empty: { textAlign: 'center', marginTop: 40 },
  error: { color: '#b91c1c', paddingHorizontal: Spacing.three },
});
