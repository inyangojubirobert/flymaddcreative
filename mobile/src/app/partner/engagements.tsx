import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';
import { createEngagement, getEngagements, updateEngagement, type Engagement } from '@/api/earnings';

// Creative engagements: a seller hires a partner for photography, video or a
// campaign. The work is paid for as an ordinary service listing through the
// normal checkout (escrow included); this tracks the brief and delivery.

const NEXT: Record<string, { status: string; label: string; who: 'seller' | 'partner' | 'both' }[]> = {
  proposed: [{ status: 'accepted', label: 'Accept', who: 'both' }, { status: 'cancelled', label: 'Cancel', who: 'both' }],
  accepted: [{ status: 'in_progress', label: 'Start work', who: 'partner' }, { status: 'cancelled', label: 'Cancel', who: 'both' }],
  in_progress: [{ status: 'delivered', label: 'Mark delivered', who: 'partner' }],
  delivered: [{ status: 'completed', label: 'Approve & complete', who: 'seller' }, { status: 'in_progress', label: 'Ask for changes', who: 'seller' }],
};

export default function EngagementsScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['engagements'], queryFn: () => getEngagements(token!), enabled: !!token });
  const [target, setTarget] = useState('');
  const [asSeller, setAsSeller] = useState(true);
  const [brief, setBrief] = useState('');
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['engagements'] });
  const fail = (e: unknown) => Alert.alert('Not saved', e instanceof ApiError ? e.message : 'Please try again.');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.section, card]}>
            <ThemedText type="smallBold">New engagement</ThemedText>
            <View style={styles.row}>
              {[true, false].map((v) => (
                <Pressable key={String(v)} onPress={() => setAsSeller(v)} style={[styles.tab, asSeller === v && styles.tabOn]}>
                  <ThemedText type="small" style={asSeller === v ? { color: Palette.white } : undefined}>{v ? 'Hire a partner' : 'Offer my services'}</ThemedText>
                </Pressable>
              ))}
            </View>
            <TextInput value={target} onChangeText={setTarget} autoCapitalize="none" placeholder={asSeller ? 'Partner handle' : 'Seller username'}
              placeholderTextColor={Palette.slate} style={[styles.input, { color: theme.text }]} />
            <TextInput value={brief} onChangeText={setBrief} multiline placeholder="What needs doing, by when, and the agreed price"
              placeholderTextColor={Palette.slate} style={[styles.input, { color: theme.text, minHeight: 70 }]} />
            <Pressable style={styles.primary} onPress={() => createEngagement(token!, asSeller
              ? { partner_handle: target.trim().replace(/^@/, ''), brief: brief.trim() }
              : { seller_username: target.trim().replace(/^@/, ''), brief: brief.trim() }).then(() => { setBrief(''); setTarget(''); refresh(); }, fail)}>
              <ThemedText type="smallBold" style={{ color: Palette.white }}>Send</ThemedText>
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary">
              Payment: the creative partner lists the service in their shop; the seller buys it there, so escrow protects both sides.
            </ThemedText>
          </View>
          {query.isLoading ? <ActivityIndicator /> : (query.data?.engagements ?? []).map((e) => <EngagementCard key={e.id} e={e} onChanged={refresh} onError={fail} />)}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function EngagementCard({ e, onChanged, onError }: { e: Engagement; onChanged: () => void; onError: (err: unknown) => void }) {
  const { token } = useAuth();
  const theme = useTheme();
  const [deliverables, setDeliverables] = useState(e.deliverables || '');
  const actions = (NEXT[e.status] || []).filter((a) => a.who === 'both' || a.who === e.role);
  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">{e.role === 'seller' ? `With @${e.partner?.handle}` : `For @${e.seller_username}`} · {e.status.replace('_', ' ')}</ThemedText>
      <ThemedText type="small">{e.brief}</ThemedText>
      {e.service ? <ThemedText type="small" themeColor="textSecondary">Service: {e.service.title} · ${Number(e.service.price_usd).toFixed(2)}</ThemedText> : null}
      {e.role === 'partner' && ['accepted', 'in_progress'].includes(e.status) ? (
        <View style={styles.row}>
          <TextInput value={deliverables} onChangeText={setDeliverables} placeholder="Links to the delivered work" placeholderTextColor={Palette.slate}
            style={[styles.input, styles.flex, { color: theme.text }]} />
          <Pressable style={styles.small} onPress={() => updateEngagement(token!, { id: e.id, deliverables }).then(onChanged, onError)}>
            <ThemedText type="smallBold" style={{ color: Palette.white }}>Save</ThemedText>
          </Pressable>
        </View>
      ) : e.deliverables ? <ThemedText type="small" themeColor="textSecondary">Delivered: {e.deliverables}</ThemedText> : null}
      <View style={styles.row}>
        {actions.map((a) => (
          <Pressable key={a.status} style={[styles.small, a.status === 'cancelled' && { backgroundColor: Palette.red }]}
            onPress={() => updateEngagement(token!, { id: e.id, status: a.status }).then(onChanged, onError)}>
            <ThemedText type="smallBold" style={{ color: Palette.white }}>{a.label}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  flex: { flex: 1 },
  input: { borderWidth: 1, borderColor: Palette.ash, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 8 },
  primary: { backgroundColor: Palette.blue, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  small: { backgroundColor: Palette.blue, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  tab: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Palette.ashSoft },
  tabOn: { backgroundColor: Palette.blue },
});
