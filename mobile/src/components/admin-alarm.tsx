import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { useAdmin } from '@/contexts/AdminContext';
import { type Conversation, waitedFor } from '@/lib/admin-shared';

// Full-screen alarm for admins (same as Book of Memes): any message waiting
// for an admin rings with sound and vibration over whatever screen is open,
// until an admin taps "Checked" or marks the conversation handled.
// "Remind me in 5 min" snoozes it on this phone; a NEW message rings at once.
// With the app closed, Telegram keeps reminding (lib/adminInbox.js).

const POLL_MS = 30000;
const SNOOZE_MS = 5 * 60000;
const VIBRATE = [0, 600, 400, 600, 400, 600];
const now = () => Date.now();

export function AdminAlarm() {
  const router = useRouter();
  const { isAdmin, adminFetch } = useAdmin();
  const [items, setItems] = useState<Conversation[]>([]);
  const [visible, setVisible] = useState(false);
  const [acking, setAcking] = useState<string | null>(null);
  const snoozeUntil = useRef(0);
  const snoozedKeys = useRef(new Set<string>());
  const player = useRef<AudioPlayer | null>(null);

  const stopRinging = useCallback(() => {
    Vibration.cancel();
    try { player.current?.pause(); } catch { /* not playing */ }
  }, []);

  const ring = useCallback(async () => {
    if (Platform.OS !== 'web') Vibration.vibrate(VIBRATE, true);
    try {
      if (!player.current) {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false });
        player.current = createAudioPlayer(require('@/assets/sounds/admin_alarm.wav'));
        player.current.loop = true;
        player.current.volume = 1;
      }
      await player.current.seekTo(0);
      player.current.play();
    } catch (error) { console.warn('[admin alarm] sound:', (error as Error).message); }
  }, []);

  const check = useCallback(async () => {
    if (!isAdmin || AppState.currentState !== 'active') return;
    let list: Conversation[];
    try { list = (await adminFetch<{ alarms: Conversation[] }>('/api/admin/alarm')).alarms; } catch { return; }
    setItems(list);
    if (!list.length) { setVisible(false); stopRinging(); return; }
    const hasNew = list.some((t) => !snoozedKeys.current.has(`${t.participant_id}@${t.waiting_since}`));
    if (now() >= snoozeUntil.current || hasNew) {
      setVisible(true);
      void ring();
    }
  }, [isAdmin, adminFetch, ring, stopRinging]);

  useEffect(() => {
    if (!isAdmin) { stopRinging(); return undefined; }
    const first = setTimeout(check, 1500);
    const timer = setInterval(check, POLL_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); else stopRinging(); });
    return () => { clearTimeout(first); clearInterval(timer); sub.remove(); stopRinging(); };
  }, [isAdmin, check, stopRinging]);

  useEffect(() => () => { try { player.current?.remove(); } catch { /* gone */ } }, []);

  const snooze = () => {
    snoozeUntil.current = now() + SNOOZE_MS;
    snoozedKeys.current = new Set(items.map((t) => `${t.participant_id}@${t.waiting_since}`));
    setVisible(false);
    stopRinging();
  };

  const ack = async (t: Conversation) => {
    setAcking(t.participant_id);
    try {
      await adminFetch('/api/admin/inbox', { method: 'POST', body: { participant_id: t.participant_id, action: 'ack' } });
      const rest = items.filter((x) => x.participant_id !== t.participant_id);
      setItems(rest);
      if (!rest.length) { setVisible(false); stopRinging(); }
    } catch { /* keeps ringing; tried again on the next check */ } finally { setAcking(null); }
  };

  const open = (t: Conversation) => {
    snooze();
    router.push({ pathname: '/admin/thread', params: { participantId: t.participant_id } } as never);
  };

  if (!isAdmin || !visible || !items.length) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={snooze}>
      <View style={s.wrap}>
        <View style={s.box}>
          <View style={s.head}>
            <Ionicons name="alarm" size={30} color="#fff" />
            <Text style={s.title}>{items.length} message{items.length === 1 ? '' : 's'} waiting for an admin</Text>
          </View>
          <ScrollView style={s.scroll}>
            {items.map((t) => (
              <View key={t.participant_id} style={s.item}>
                <Text style={s.kind}>
                  {t.label} · waiting {waitedFor(t.waiting_since)}
                  {t.reminder_count ? ` · ${t.reminder_count} reminder${t.reminder_count === 1 ? '' : 's'} sent` : ''}
                </Text>
                <Text style={s.from}>{t.participant ? `@${t.participant.username}${t.participant.name ? ` (${t.participant.name})` : ''}` : 'A participant'}</Text>
                {t.last_user_message ? <Text style={s.msg} numberOfLines={3}>“{t.last_user_message}”</Text> : null}
                <View style={s.row}>
                  <Pressable style={[s.btn, s.btnOpen]} onPress={() => open(t)}><Text style={s.btnText}>Open</Text></Pressable>
                  <Pressable style={[s.btn, s.btnAck]} onPress={() => ack(t)} disabled={acking === t.participant_id}>
                    {acking === t.participant_id ? <ActivityIndicator color="#0D1525" /> : <Text style={[s.btnText, s.ackText]}>Checked ✓</Text>}
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable onPress={snooze} style={s.snooze}><Text style={s.snoozeText}>Remind me in 5 min</Text></Pressable>
          <Text style={s.note}>It keeps ringing (and Telegram keeps reminding) until each one is checked off or handled.</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'rgba(80,0,0,0.85)', justifyContent: 'center', padding: 18 },
  box: { backgroundColor: '#1a0b0b', borderRadius: 20, padding: 18, borderWidth: 2, borderColor: '#EF4444', maxWidth: 560, width: '100%', alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', flex: 1 },
  scroll: { maxHeight: 380 },
  item: { backgroundColor: '#2a1212', borderRadius: 14, padding: 12, marginBottom: 10 },
  kind: { color: '#FCA5A5', fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase' },
  from: { color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 3 },
  msg: { color: '#E5E7EB', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  btnOpen: { borderWidth: 1, borderColor: '#FCA5A5' },
  btnAck: { backgroundColor: '#34D399' },
  btnText: { color: '#fff', fontWeight: '800' },
  ackText: { color: '#0D1525' },
  snooze: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  snoozeText: { color: '#FCA5A5', fontWeight: '800' },
  note: { color: '#9CA3AF', fontSize: 11, textAlign: 'center' },
});
