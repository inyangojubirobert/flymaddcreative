import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getOwnCreatorPlan, saveCreatorPlan, type OwnCreatorPlan } from '@/api/digital';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

// Creator: a monthly subscription that unlocks every published digital
// product they include. Subscribers pay through Google Play (Android) or by
// card on the website; renewals are monthly and can be cancelled any time.

export default function CreatorSubscriptionScreen() {
  const { token } = useAuth();
  const query = useQuery({ queryKey: ['own-creator-plan'], queryFn: () => getOwnCreatorPlan(token!), enabled: !!token });
  if (query.isLoading || !query.data) {
    return <ThemedView style={styles.container}>{query.isError ? <ThemedText style={styles.loading}>Could not load.</ThemedText> : <ActivityIndicator style={styles.loading} />}</ThemedView>;
  }
  return <PlanForm data={query.data} />;
}

function PlanForm({ data }: { data: OwnCreatorPlan }) {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [tierId, setTierId] = useState<string | null>(data.plan?.tier_id ?? null);
  const [description, setDescription] = useState(data.plan?.description || '');
  const [active, setActive] = useState(data.plan?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  async function save(nextActive = active) {
    if (!tierId) return Alert.alert('Choose a price', 'Pick a monthly price first.');
    const run = async () => {
      setBusy(true);
      try {
        const result = await saveCreatorPlan(token!, { tier_id: tierId, description: description.trim(), is_active: nextActive });
        setActive(nextActive);
        await queryClient.invalidateQueries({ queryKey: ['own-creator-plan'] });
        Alert.alert('Saved', nextActive ? 'Your subscription is available on your digital products.'
          : `Subscription turned off.${result.renewals_stopped ? ` Renewals stopped for ${result.renewals_stopped} subscriber(s); they keep access until their paid month ends.` : ''}`);
      } catch (error) {
        Alert.alert('Not saved', error instanceof ApiError ? error.message : 'Please try again.');
      } finally {
        setBusy(false);
      }
    };
    if (!nextActive && data?.plan?.is_active) {
      Alert.alert('Turn off your subscription?', 'No new subscribers, and current subscriptions stop renewing. Subscribers keep access until the month they paid for ends.', [
        { text: 'Keep it on', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => void run() },
      ]);
      return;
    }
    await run();
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Monthly subscription' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Your monthly subscription</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Subscribers get every digital product you include, for as long as they keep paying. They pay through Google Play in the Android app or by card on the website.
          </ThemedText>

          {data.plan ? (
            <View style={[styles.status, active ? styles.statusLive : null]}>
              <ThemedText type="smallBold">{active ? 'On' : 'Off'} · {data.subscribers} active subscriber{data.subscribers === 1 ? '' : 's'}</ThemedText>
            </View>
          ) : null}

          <ThemedText type="smallBold">Monthly price</ThemedText>
          <View style={styles.chips}>
            {data.tiers.map((t) => (
              <Pressable key={t.id} onPress={() => setTierId(t.id)} style={[styles.chip, tierId === t.id && styles.chipOn]}>
                <ThemedText type="smallBold" style={{ color: tierId === t.id ? Palette.white : Palette.blueDark }}>${t.price_usd.toFixed(2)}</ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">A new price applies to new subscribers. Existing subscribers keep the price they signed up at.</ThemedText>

          <ThemedText type="smallBold">What subscribers get (optional)</ThemedText>
          <TextInput value={description} onChangeText={setDescription} maxLength={500} multiline placeholder="e.g. New chapters every week, all my music, early access…"
            placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]} />

          <ThemedText type="smallBold">Included products ({data.items.length})</ThemedText>
          {data.items.length ? data.items.map((i) => (
            <View key={i.item_id} style={styles.itemRow}>
              <Ionicons name={i.kind === 'ebook' ? 'book' : i.kind === 'audio' ? 'musical-notes' : 'film'} size={16} color={Palette.blue} />
              <ThemedText type="small" numberOfLines={1} style={styles.flex}>{i.title}</ThemedText>
            </View>
          )) : (
            <ThemedText type="small" themeColor="textSecondary">None yet. Publish a digital product with &quot;Include in my monthly subscription&quot; ticked. The subscription is only offered once at least one product is included.</ThemedText>
          )}

          <Pressable onPress={() => void save(active || !data.plan)} disabled={busy} style={[styles.primary, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color={Palette.lemonInk} /> : <ThemedText type="smallBold" style={styles.primaryText}>{data.plan ? 'Save' : 'Start offering a subscription'}</ThemedText>}
          </Pressable>
          {data.plan ? (
            <Pressable onPress={() => void save(!active)} disabled={busy} style={[styles.secondary, busy && styles.disabled]}>
              <ThemedText type="smallBold" style={styles.secondaryText}>{active ? 'Turn subscription off' : 'Turn subscription back on'}</ThemedText>
            </Pressable>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Each paid month is added to Wallet → Digital sales: price − store or card fee − One Dream&apos;s commission, held briefly for refunds, then paid out by One Dream. Refunded months are deducted.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  status: { borderRadius: 14, padding: Spacing.three, backgroundColor: Palette.ashSoft },
  statusLive: { backgroundColor: '#DCFCE7' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Palette.blueSoft },
  chipOn: { backgroundColor: Palette.blue },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  primary: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: Palette.lemon, marginTop: Spacing.two },
  primaryText: { color: Palette.lemonInk, fontSize: 15 },
  secondary: { borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Palette.blueSoft },
  secondaryText: { color: Palette.blueDark },
  disabled: { opacity: 0.5 },
});
