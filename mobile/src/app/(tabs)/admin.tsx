import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { useAdmin } from '@/contexts/AdminContext';
import { useTheme } from '@/hooks/use-theme';

// Admin tab: only shown to admins (contexts/AdminContext.tsx). Same layout of
// jobs as Book of Memes' admin screens: the inbox (questions and withdrawal
// requests), withdrawals to pay, alerts, and brand promotion.

const ADMIN_PORTAL_URL = 'https://flymaddcreative.vercel.app/admin-portal.html';

type Counts = { inboxOpen: number | null; waiting: number | null; pending: number | null; processing: number | null; telegram: boolean | null };

export default function AdminScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isAdmin, admin, adminFetch } = useAdmin();
  const [counts, setCounts] = useState<Counts>({ inboxOpen: null, waiting: null, pending: null, processing: null, telegram: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [inbox, pending, processing, alerts] = await Promise.allSettled([
      adminFetch<{ counts: { open: number; waiting: number } }>('/api/admin/inbox?status=open'),
      adminFetch<{ withdrawals: unknown[] }>('/api/admin/withdrawals?status=pending&limit=250'),
      adminFetch<{ withdrawals: unknown[] }>('/api/admin/withdrawals?status=processing&limit=250'),
      adminFetch<{ alerts: { enabled: boolean; telegram_connected: boolean } }>('/api/admin/alerts'),
    ]);
    setCounts({
      inboxOpen: inbox.status === 'fulfilled' ? inbox.value.counts.open : null,
      waiting: inbox.status === 'fulfilled' ? inbox.value.counts.waiting : null,
      pending: pending.status === 'fulfilled' ? pending.value.withdrawals.length : null,
      processing: processing.status === 'fulfilled' ? processing.value.withdrawals.length : null,
      telegram: alerts.status === 'fulfilled' ? alerts.value.alerts.enabled && alerts.value.alerts.telegram_connected : null,
    });
    const failed = [inbox, pending, processing, alerts].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setError(failed ? (failed.reason as Error)?.message || 'Some admin data could not load' : null);
    setLoading(false);
  }, [isAdmin, adminFetch]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!isAdmin) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">This tab is for One Dream admins.</ThemedText>
      </ThemedView>
    );
  }

  const n = (v: number | null) => (v === null ? '…' : String(v));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        >
          <ThemedText type="title" style={styles.pageTitle}>Admin</ThemedText>
          <ThemedText themeColor="textSecondary">Signed in as {admin?.display_name || admin?.email || 'admin'}. Only admins see this tab.</ThemedText>
          {error ? <ThemedText type="small" style={styles.error}>{error}</ThemedText> : null}

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <Row icon="file-tray-full" color={Palette.blue} bg={Palette.blueSoft} title="Inbox"
              subtitle={`${n(counts.inboxOpen)} open · ${n(counts.waiting)} waiting for a reply`}
              badge={counts.waiting} onPress={() => router.push('/admin/inbox' as never)} />
            <Divider />
            <Row icon="arrow-up-circle" color={Palette.yellowInk} bg={Palette.yellowSoft} title="Withdrawals"
              subtitle={`${n(counts.pending)} pending · ${n(counts.processing)} processing`}
              badge={counts.pending} onPress={() => router.push('/admin/withdrawals' as never)} />
            <Divider />
            <Row icon="alarm" color={Palette.red} bg={Palette.redSoft} title="Alerts & reminders"
              subtitle={counts.telegram === null ? 'Telegram and phone alerts' : counts.telegram ? 'Telegram on · reminders until checked off' : 'Telegram off: set it up'}
              onPress={() => router.push('/admin/alerts' as never)} />
            <Divider />
            <Row icon="megaphone" color={Palette.yellowInk} bg={Palette.yellowSoft} title="Brand promotion"
              subtitle="Upload an ad for our products" onPress={() => router.push('/brand-promo' as never)} />
            <Divider />
            <Row icon="open-outline" color={Palette.slate} bg={Palette.ashSoft} title="Admin portal (web)"
              subtitle="Everything else: ads review, gifts, earnings, packages" onPress={() => void Linking.openURL(ADMIN_PORTAL_URL)} />
          </View>
          {loading && counts.inboxOpen === null ? <ActivityIndicator color={Palette.blue} /> : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />;
}

function Row({ icon, color, bg, title, subtitle, badge, onPress }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; title: string; subtitle: string; badge?: number | null; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
      <View style={[styles.icon, { backgroundColor: bg }]}><Ionicons name={icon} size={20} color={color} /></View>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText>
      </View>
      {badge ? <View style={styles.badge}><ThemedText style={styles.badgeText}>{badge > 99 ? '99+' : badge}</ThemedText></View> : null}
      <Ionicons name="chevron-forward" size={18} color={Palette.slate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
  pageTitle: { fontSize: 30 },
  card: { borderRadius: 18, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 13, gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, marginLeft: 70 },
  pressed: { opacity: 0.7 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: Palette.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 16 },
  error: { color: '#b91c1c' },
});
