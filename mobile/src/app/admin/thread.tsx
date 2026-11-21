import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useAdmin } from '@/contexts/AdminContext';
import { useTheme } from '@/hooks/use-theme';

// One participant's conversation with the admins: read, reply, check off the
// alarm, mark handled. Uses /api/admin/messages (same as the web portal).

type Message = { id: string; withdrawal_id: string | null; sender_type: 'participant' | 'admin' | 'system'; message_type: string; body: string; created_at: string };
type Person = { id: string; name: string | null; username: string; email: string | null };

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminThreadScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { participantId } = useLocalSearchParams<{ participantId: string }>();
  const { adminFetch } = useAdmin();
  const [person, setPerson] = useState<Person | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      const d = await adminFetch<{ participant: Person; messages: Message[] }>(`/api/admin/messages?participant_id=${encodeURIComponent(String(participantId))}`);
      setPerson(d.participant); setMessages(d.messages); setError(null);
    } catch (e) { setError((e as Error).message || 'Could not load the conversation'); }
  }, [adminFetch, participantId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const lastWithdrawal = [...(messages || [])].reverse().find((m) => m.withdrawal_id)?.withdrawal_id || null;

  async function send() {
    const body = reply.trim();
    if (!body) return;
    setBusy('send'); setError(null);
    try {
      await adminFetch('/api/admin/messages', { method: 'POST', body: { participant_id: participantId, body, withdrawal_id: lastWithdrawal || undefined } });
      setReply('');
      await load();
    } catch (e) { setError((e as Error).message || 'Could not send'); } finally { setBusy(null); }
  }

  async function act(action: 'ack' | 'handled' | 'open') {
    setBusy(action); setError(null);
    try {
      await adminFetch('/api/admin/inbox', { method: 'POST', body: { participant_id: participantId, action } });
      setNotice(action === 'ack' ? 'Checked: the alarm stops until they write again.' : action === 'handled' ? 'Marked handled.' : 'Reopened.');
      if (action === 'handled') router.back();
    } catch (e) { setError((e as Error).message || 'Could not update'); } finally { setBusy(null); }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: person ? `@${person.username}` : 'Conversation' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
          {person ? (
            <View style={[styles.head, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">{person.name || person.username}</ThemedText>
              {person.email ? <ThemedText type="small" themeColor="textSecondary">{person.email}</ThemedText> : null}
              <View style={styles.actions}>
                <Pill label="Checked ✓" color={Palette.green} busy={busy === 'ack'} onPress={() => act('ack')} />
                <Pill label="Mark handled" color={Palette.blue} busy={busy === 'handled'} onPress={() => act('handled')} />
                <Pill label="Reopen" color={Palette.slate} busy={busy === 'open'} onPress={() => act('open')} />
                {lastWithdrawal ? <Pill label="Withdrawals" color={Palette.yellow} onPress={() => router.push('/admin/withdrawals' as never)} /> : null}
              </View>
              {notice ? <ThemedText type="small" themeColor="textSecondary">{notice}</ThemedText> : null}
            </View>
          ) : null}
          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
          {messages === null ? <ActivityIndicator style={styles.loading} color={Palette.blue} /> : (
            <ScrollView ref={scroll} contentContainerStyle={styles.list} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
              {messages.map((m) => {
                const mine = m.sender_type !== 'participant';
                return (
                  <View key={m.id} style={[styles.bubble, mine ? styles.mine : [styles.theirs, { backgroundColor: theme.backgroundElement }]]}>
                    {m.sender_type === 'system' ? <ThemedText type="small" style={styles.systemTag}>Automatic notice</ThemedText> : null}
                    {m.withdrawal_id && m.sender_type === 'participant' ? <ThemedText type="small" style={styles.withdrawTag}>Withdrawal request</ThemedText> : null}
                    <ThemedText style={mine ? styles.mineText : undefined}>{m.body}</ThemedText>
                    <ThemedText type="small" style={mine ? styles.mineTime : styles.time}>{time(m.created_at)}</ThemedText>
                  </View>
                );
              })}
            </ScrollView>
          )}
          <View style={[styles.composer, { backgroundColor: theme.backgroundElement }]}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder="Reply as One Dream support"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text }]}
              multiline
              maxLength={2000}
            />
            <Pressable onPress={send} disabled={busy === 'send' || !reply.trim()} style={[styles.send, (!reply.trim() || busy === 'send') && styles.disabled]}>
              {busy === 'send' ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.sendText}>Send</ThemedText>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Pill({ label, color, busy, onPress }: { label: string; color: string; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={[styles.pill, { borderColor: color }]}>
      {busy ? <ActivityIndicator size="small" color={color} /> : <ThemedText type="smallBold" style={{ color }}>{label}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  head: { margin: Spacing.three, marginBottom: Spacing.two, borderRadius: 14, padding: Spacing.three, gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  pill: { borderWidth: 1, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, minWidth: 70, alignItems: 'center' },
  list: { padding: Spacing.three, gap: Spacing.two },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: Spacing.two, paddingHorizontal: Spacing.three, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: Palette.blue },
  theirs: { alignSelf: 'flex-start' },
  mineText: { color: '#fff' },
  mineTime: { color: '#dbeafe', fontSize: 11 },
  time: { color: Palette.slate, fontSize: 11 },
  systemTag: { color: '#dbeafe', fontWeight: '700' },
  withdrawTag: { color: Palette.yellow, fontWeight: '700' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, padding: Spacing.two, margin: Spacing.two, borderRadius: 16 },
  input: { flex: 1, maxHeight: 120, fontSize: 16, paddingHorizontal: Spacing.two, paddingVertical: 8 },
  send: { backgroundColor: Palette.blue, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  loading: { marginTop: 40 },
  error: { color: '#b91c1c', paddingHorizontal: Spacing.three },
});
