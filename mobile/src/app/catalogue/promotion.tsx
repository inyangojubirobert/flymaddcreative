import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';
import { getPromoOverview, submitPromoVideo, withdrawPromoVideo, type PromoSubmission } from '@/api/promo';

// One Dream Storefront Promotion: a seller chooses, per video, whether One
// Dream may use it in external social media advertising. Off by default;
// showing a video on the storefront never opts it in.

const STATUS: Record<PromoSubmission['status'], { label: string; tone: string }> = {
  submitted: { label: 'Submitted · under review', tone: Palette.yellowInk },
  selected: { label: 'Selected for external promotion', tone: Palette.green },
  not_selected: { label: 'Not selected this time', tone: Palette.slate },
  withdrawn: { label: 'Consent withdrawn', tone: Palette.slate },
};

export default function PromotionScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['promo-overview'], queryFn: () => getPromoOverview(token!), enabled: !!token });
  const [itemId, setItemId] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = query.data;

  if (query.isLoading) return <ActivityIndicator size="large" style={styles.loading} />;
  if (query.isError || !data) {
    return <ThemedText style={styles.loading} themeColor="textSecondary">{query.error instanceof ApiError ? query.error.message : 'Couldn’t load the programme.'}</ThemedText>;
  }

  const { terms, eligibility, submissions } = data;
  const live = new Set(submissions.filter((s) => s.status !== 'withdrawn').map((s) => `${s.item_id}|${s.video_url}`));
  const available = eligibility.videos.filter((v) => !live.has(`${v.item_id}|${v.video_url}`));
  const chosen = available.find((v) => v.item_id === itemId) ?? null;
  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }];

  async function submit() {
    if (!chosen || !agreed || !token) return;
    setBusy(true);
    try {
      await submitPromoVideo(token, { item_id: chosen.item_id, terms_version: terms.version });
      setItemId(null);
      setAgreed(false);
      Alert.alert('Video submitted', 'Thank you. One Dream will review it for its external campaigns.');
      await queryClient.invalidateQueries({ queryKey: ['promo-overview'] });
    } catch (e) {
      Alert.alert('Not submitted', e instanceof ApiError ? e.message : 'Please try again.');
      if (e instanceof ApiError && e.status === 409) void query.refetch();
    } finally {
      setBusy(false);
    }
  }

  function withdraw(s: PromoSubmission) {
    Alert.alert('Withdraw consent?', 'One Dream will stop using this video in future promotion. Posts and ads already published are not removed automatically.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw', style: 'destructive', onPress: () => {
          void withdrawPromoVideo(token!, s.id).then(() => queryClient.invalidateQueries({ queryKey: ['promo-overview'] }))
            .catch((e) => Alert.alert('Not withdrawn', e instanceof ApiError ? e.message : 'Please try again.'));
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'External promotion' }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
        <View style={card}>
          <ThemedText type="subtitle">{terms.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            One Dream features selected seller videos in its own social media advertising (TikTok, Instagram, Facebook, YouTube), linking to your storefront. Submit your promotional videos for a chance to be featured. Selected videos may receive up to US${terms.max_ad_spend_usd.toFixed(0)} in advertising funded by One Dream (not necessarily the full amount), from a US${terms.programme_budget_usd.toLocaleString('en-US')} programme budget. Submit as many videos as you like; {terms.max_selected_per_seller ? `up to ${terms.max_selected_per_seller} of yours can be funded each round` : 'more than one can be selected'}. It isn{'’'}t cash, a wallet balance or an in-app credit, and selection isn{'’'}t guaranteed.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Taking part is optional. Your video shows on your storefront either way.</ThemedText>
          <Pressable onPress={() => setShowTerms((v) => !v)}>
            <ThemedText type="linkPrimary">{showTerms ? 'Hide the full terms' : 'Read the full terms'}</ThemedText>
          </Pressable>
          {showTerms ? <ThemedText type="small">{terms.body}</ThemedText> : null}
        </View>

        <View style={card}>
          <ThemedText type="smallBold">Can I take part?</ThemedText>
          <Check ok={eligibility.eligible} text={`${eligibility.active_listings} of ${eligibility.required_listings} active listings`} />
          <Check ok={eligibility.videos.length > 0} text={eligibility.videos.length ? `${eligibility.videos.length} listing${eligibility.videos.length === 1 ? '' : 's'} with a promotional video` : 'Add a promotional video to a listing (My Listings → Edit)'} />
        </View>

        {eligibility.eligible && available.length ? (
          <View style={card}>
            <ThemedText type="smallBold">Submit a video</ThemedText>
            {available.map((v) => (
              <Pressable key={`${v.item_id}|${v.video_url}`} onPress={() => setItemId(v.item_id)} style={[styles.video, { borderColor: v.item_id === itemId ? Palette.blue : theme.backgroundSelected }]}
                accessibilityRole="radio" accessibilityState={{ selected: v.item_id === itemId }}>
                {v.image ? <Image source={{ uri: v.image }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: Palette.ashSoft }]} />}
                <View style={styles.flex}>
                  <ThemedText type="smallBold" numberOfLines={2}>{v.title}</ThemedText>
                  <Pressable onPress={() => void Linking.openURL(v.video_url)}><ThemedText type="small" themeColor="textSecondary">Watch video</ThemedText></Pressable>
                </View>
                <Ionicons name={v.item_id === itemId ? 'radio-button-on' : 'radio-button-off'} size={20} color={Palette.blue} />
              </Pressable>
            ))}
            <Pressable onPress={() => setAgreed((v) => !v)} style={styles.consent} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
              <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={Palette.blue} />
              <ThemedText type="small" style={styles.flex}>{terms.consent} I own this video or have permission for everything in it, and I{'’'}ve read the terms.</ThemedText>
            </Pressable>
            <Pressable onPress={submit} disabled={!chosen || !agreed || busy} style={[styles.button, (!chosen || !agreed || busy) && styles.disabled]}>
              {busy ? <ActivityIndicator color={Palette.white} /> : <ThemedText style={styles.buttonText}>Submit for external promotion</ThemedText>}
            </Pressable>
          </View>
        ) : null}

        <ThemedText type="smallBold">Your submissions</ThemedText>
        {submissions.length ? submissions.map((s) => {
          const title = eligibility.videos.find((v) => v.item_id === s.item_id)?.title ?? 'Listing video';
          return (
            <View key={s.id} style={card}>
              <ThemedText type="smallBold">{title}</ThemedText>
              <ThemedText type="small" style={{ color: STATUS[s.status].tone }}>{STATUS[s.status].label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Consent given {new Date(s.consent_at).toLocaleDateString()} (terms v{s.terms_version}){s.withdrawn_at ? ` · withdrawn ${new Date(s.withdrawn_at).toLocaleDateString()}` : ''}</ThemedText>
              {s.review_note ? <ThemedText type="small" themeColor="textSecondary">{s.review_note}</ThemedText> : null}
              {s.campaigns.map((c, i) => (
                <Pressable key={i} disabled={!c.campaign_url} onPress={() => c.campaign_url && void Linking.openURL(c.campaign_url)}>
                  <ThemedText type="small">Promoted on {c.platform} · {c.spent_on}{c.campaign_url ? ' · view' : ''}</ThemedText>
                </Pressable>
              ))}
              {s.status !== 'withdrawn' ? (
                <Pressable onPress={() => withdraw(s)}><ThemedText type="small" style={{ color: Palette.red }}>Withdraw consent</ThemedText></Pressable>
              ) : null}
            </View>
          );
        }) : <ThemedText type="small" themeColor="textSecondary">You haven{'’'}t submitted a video yet.</ThemedText>}
      </ScrollView>
    </ThemedView>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.check}>
      <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={ok ? Palette.green : Palette.slate} />
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { marginTop: Spacing.five, textAlign: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  video: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 10, padding: Spacing.two },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  flex: { flex: 1 },
  consent: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', paddingVertical: Spacing.two },
  button: { backgroundColor: Palette.blue, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: Palette.white, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
