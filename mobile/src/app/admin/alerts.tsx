import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useAdmin } from '@/contexts/AdminContext';
import { useTheme } from '@/hooks/use-theme';

// Admin alerts: Telegram (free, instant) plus phone alerts. Every message and
// withdrawal request goes to Telegram, then a reminder every few minutes
// until an admin checks it off, and a daily summary of what is still open.
// With the app open, waiting messages also ring full-screen (AdminAlarm).

type Alerts = { enabled: boolean; telegram_connected: boolean; telegram_bot: string | null; reminder_minutes: number; digest_hour: number; timezone: string };

export default function AdminAlertsSettings() {
  const theme = useTheme();
  const router = useRouter();
  const { adminFetch } = useAdmin();
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [botToken, setBotToken] = useState('');
  const [minutes, setMinutes] = useState('15');
  const [hour, setHour] = useState('8');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  const show = (a: Alerts) => { setAlerts(a); setMinutes(String(a.reminder_minutes)); setHour(String(a.digest_hour)); };

  const load = useCallback(async () => {
    try { show((await adminFetch<{ alerts: Alerts }>('/api/admin/alerts')).alerts); setError(null); } catch (e) { setError((e as Error).message); }
  }, [adminFetch]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save(body: Record<string, unknown>, label: string, done: string) {
    setBusy(label); setError(null); setNotice(null);
    try {
      show((await adminFetch<{ alerts: Alerts }>('/api/admin/alerts', { method: 'POST', body })).alerts);
      setNotice(done);
      if (body.telegram_bot_token) setBotToken('');
    } catch (e) { setError((e as Error).message || 'Could not save'); } finally { setBusy(null); }
  }

  async function test() {
    setBusy('test'); setError(null); setNotice(null);
    try { await adminFetch('/api/admin/alerts', { method: 'POST', body: { action: 'test' } }); setNotice('Test sent. Check Telegram.'); }
    catch (e) { setError((e as Error).message || 'Test failed'); } finally { setBusy(null); }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Alerts & reminders' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {alerts === null && !error ? <ActivityIndicator color={Palette.blue} /> : null}
        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
        {notice ? <ThemedText style={styles.notice}>{notice}</ThemedText> : null}

        <ThemedText type="subtitle">Telegram</ThemedText>
        {alerts?.telegram_connected ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">Connected{alerts.telegram_bot ? ` to @${alerts.telegram_bot}` : ''} · {alerts.enabled ? 'on' : 'off'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Every message and withdrawal request is sent here, then reminded every {alerts.reminder_minutes} min until it is checked off, plus a summary each day at {alerts.digest_hour}:00 ({alerts.timezone}).</ThemedText>
            <View style={styles.row}>
              <Button label={alerts.enabled ? 'Turn off' : 'Turn on'} busy={busy === 'toggle'} color={alerts.enabled ? Palette.slate : Palette.green}
                onPress={() => save({ enabled: !alerts.enabled }, 'toggle', alerts.enabled ? 'Telegram alerts are off.' : 'Telegram alerts are on.')} />
              <Button label="Send test" busy={busy === 'test'} color={Palette.blue} onPress={test} />
            </View>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">Set up in 2 minutes (free)</ThemedText>
            <ThemedText type="small">1. In Telegram, open @BotFather, send /newbot and follow the steps. It gives you a bot token.</ThemedText>
            <ThemedText type="small">2. Open your new bot and press Start (or send it any message).</ThemedText>
            <ThemedText type="small">3. Paste the token here and tap Connect.</ThemedText>
            <Pressable onPress={() => void Linking.openURL('https://t.me/BotFather')}><ThemedText type="smallBold" style={styles.link}>Open @BotFather</ThemedText></Pressable>
          </View>
        )}
        <TextInput value={botToken} onChangeText={setBotToken} autoCapitalize="none" autoCorrect={false}
          placeholder={alerts?.telegram_connected ? 'New bot token (to change bot)' : 'Bot token, e.g. 123456:ABC-DEF…'}
          placeholderTextColor={theme.textSecondary} style={input} />
        <Button label="Connect" busy={busy === 'connect'} color={Palette.blue} solid
          onPress={() => (botToken.trim() ? save({ telegram_bot_token: botToken.trim() }, 'connect', 'Connected. Alerts are on; tap Send test.') : setError('Paste the bot token first.'))} />

        <ThemedText type="subtitle" style={styles.section}>Reminders</ThemedText>
        <View style={styles.row}>
          <View style={styles.flex}>
            <ThemedText type="small" themeColor="textSecondary">Remind every (minutes)</ThemedText>
            <TextInput value={minutes} onChangeText={setMinutes} keyboardType="number-pad" style={input} />
          </View>
          <View style={styles.flex}>
            <ThemedText type="small" themeColor="textSecondary">Daily summary hour (0-23)</ThemedText>
            <TextInput value={hour} onChangeText={setHour} keyboardType="number-pad" style={input} />
          </View>
        </View>
        <Button label="Save reminders" busy={busy === 'rem'} color={Palette.blue}
          onPress={() => save({ reminder_minutes: Number(minutes), digest_hour: Number(hour) }, 'rem', 'Saved.')} />

        <ThemedText type="subtitle" style={styles.section}>On this phone</ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small">While the app is open, a waiting message rings full-screen with sound and vibration until you tap Checked (or snooze 5 min). A new message rings again.</ThemedText>
          <ThemedText type="small">Phone notifications reach you when the app is closed.</ThemedText>
          <Button label="Phone notifications" color={Palette.blue} onPress={() => router.push('/admin-alerts' as never)} />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Button({ label, color, busy, solid, onPress }: { label: string; color: string; busy?: boolean; solid?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={[styles.button, { borderColor: color }, solid && { backgroundColor: color }]}>
      {busy ? <ActivityIndicator color={solid ? '#fff' : color} /> : <ThemedText type="smallBold" style={{ color: solid ? '#fff' : color }}>{label}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.five },
  card: { borderRadius: 14, padding: Spacing.three, gap: 6 },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 15 },
  button: { borderWidth: 1, borderRadius: 12, minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  section: { marginTop: Spacing.two },
  link: { color: Palette.blue, marginTop: 4 },
  error: { color: '#b91c1c' },
  notice: { color: Palette.green },
});
