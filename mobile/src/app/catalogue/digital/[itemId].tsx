import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  deleteDigitalFile, getSellerDigital, saveSellerDigital, submitSellerDigital, uploadDigitalFile,
  type DigitalAssetKind, type DigitalKind,
} from '@/api/digital';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

// Seller: sell one of your product listings as digital content (e-book PDF
// or EPUB, audio tracks or video lessons). Price = a Google Play price tier
// (the website charges the same USD price by card). Optionally included in
// the creator's monthly subscription.

const KINDS: { id: DigitalKind; label: string; icon: keyof typeof Ionicons.glyphMap; asset: DigitalAssetKind; mime: string[]; hint: string }[] = [
  { id: 'ebook', label: 'E-book (PDF / EPUB)', icon: 'book', asset: 'pdf', mime: ['application/pdf', 'application/epub+zip'], hint: 'One PDF (up to 50 MB, 300 pages) or one DRM-free EPUB (up to 50 MB)' },
  { id: 'audio', label: 'Audio', icon: 'musical-notes', asset: 'audio', mime: ['audio/*'], hint: 'MP3, M4A, AAC or WAV tracks, up to 100 MB each' },
  { id: 'video', label: 'Video', icon: 'film', asset: 'video', mime: ['video/*'], hint: 'MP4, MOV or WebM lessons, up to 200 MB each' },
];

const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft - not on sale yet',
  pending_review: 'Waiting for One Dream review',
  published: 'On sale',
  rejected: 'Needs changes',
  suspended: 'Taken off sale',
};

export default function DigitalProductSetupScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['seller-digital', itemId], queryFn: () => getSellerDigital(token!, itemId), enabled: !!token && !!itemId });
  const data = query.data;

  const [kind, setKind] = useState<DigitalKind>('ebook');
  const [tierId, setTierId] = useState<string | null>(null);
  const [previewPages, setPreviewPages] = useState(3);
  const [previewSeconds, setPreviewSeconds] = useState(30);
  const [rights, setRights] = useState(false);
  const [inSubscription, setInSubscription] = useState(true);
  const router = useRouter();
  const [trackTitle, setTrackTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.product) return;
    setKind(data.product.kind);
    setTierId(data.product.tier_id);
    setPreviewPages(data.product.preview_pages);
    setPreviewSeconds(data.product.preview_seconds);
    setRights(data.product.rights_confirmed);
    setInSubscription(data.product.in_subscription !== false);
  }, [data?.product]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['seller-digital', itemId] });
  const kindInfo = KINDS.find((k) => k.id === kind)!;
  const files = data?.assets ?? [];
  const status = data?.product?.status ?? 'draft';

  async function run(label: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(label);
    try {
      await fn();
      await refresh();
      if (success) Alert.alert('Done', success);
    } catch (error) {
      Alert.alert('Not saved', error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const save = () => {
    if (!tierId) return Alert.alert('Choose a price', 'Pick one of the price options.');
    return run('save', () => saveSellerDigital(token!, { item_id: itemId, kind, tier_id: tierId, preview_pages: previewPages, preview_seconds: previewSeconds, rights_confirmed: rights, in_subscription: inSubscription }), 'Saved.');
  };

  async function upload() {
    if (!data?.product) return Alert.alert('Save first', 'Choose the type and price, then save before uploading files.');
    const picked = await DocumentPicker.getDocumentAsync({ type: kindInfo.mime, copyToCacheDirectory: true, multiple: false });
    const file = picked.canceled ? null : picked.assets?.[0];
    if (!file) return;
    const isEpub = kind === 'ebook' && (/\.epub$/i.test(file.name || '') || file.mimeType === 'application/epub+zip');
    await run('upload', () => uploadDigitalFile(token!, {
      itemId, assetKind: isEpub ? 'epub' : kindInfo.asset, title: trackTitle.trim() || file.name?.replace(/\.[^.]+$/, ''),
      file: { uri: file.uri, name: isEpub && !/\.epub$/i.test(file.name || '') ? 'book.epub' : file.name, mimeType: file.mimeType, size: file.size },
    }));
    setTrackTitle('');
  }

  function removeFile(id: string) {
    Alert.alert('Remove this file?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void run('remove', () => deleteDigitalFile(token!, id)) },
    ]);
  }

  if (query.isLoading || !data) {
    return <ThemedView style={styles.container}>{query.isError ? <ThemedText style={styles.loading}>Listing not found.</ThemedText> : <ActivityIndicator style={styles.loading} />}</ThemedView>;
  }

  const field = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }];
  const canSubmit = ['draft', 'rejected'].includes(status) && rights && files.length > 0 && !!data.product;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Sell as digital' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle" numberOfLines={2}>{data.listing.title}</ThemedText>
          <View style={[styles.status, status === 'published' ? styles.statusLive : status === 'rejected' || status === 'suspended' ? styles.statusBad : null]}>
            <ThemedText type="smallBold">{STATUS_TEXT[status]}</ThemedText>
            {data.product?.review_note ? <ThemedText type="small">{data.product.review_note}</ThemedText> : null}
            {data.active_licenses ? <ThemedText type="small">{data.active_licenses} buyer{data.active_licenses === 1 ? '' : 's'} own this</ThemedText> : null}
          </View>

          <ThemedText type="smallBold">Type</ThemedText>
          <View style={styles.chips}>
            {KINDS.map((k) => (
              <Pressable key={k.id} disabled={files.length > 0} onPress={() => setKind(k.id)} style={[styles.chip, kind === k.id && styles.chipOn, files.length > 0 && kind !== k.id && styles.disabled]}>
                <Ionicons name={k.icon} size={15} color={kind === k.id ? Palette.white : Palette.blueDark} />
                <ThemedText type="smallBold" style={{ color: kind === k.id ? Palette.white : Palette.blueDark }}>{k.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="smallBold">Price</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Sold through Google Play. Buyers see their local price. Your listing price updates to match.</ThemedText>
          <View style={styles.chips}>
            {data.tiers.map((t) => (
              <Pressable key={t.id} onPress={() => setTierId(t.id)} style={[styles.chip, tierId === t.id && styles.chipOn]}>
                <ThemedText type="smallBold" style={{ color: tierId === t.id ? Palette.white : Palette.blueDark }}>${t.price_usd.toFixed(2)}</ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="smallBold">Free preview</ThemedText>
          <View style={styles.stepperRow}>
            <ThemedText type="small" style={styles.flex}>{kind === 'ebook' ? `First ${previewPages} page${previewPages === 1 ? '' : 's'}` : `First ${previewSeconds} seconds`}</ThemedText>
            <Pressable onPress={() => (kind === 'ebook' ? setPreviewPages(Math.max(0, previewPages - 1)) : setPreviewSeconds(Math.max(0, previewSeconds - 10)))} style={styles.step}><Ionicons name="remove" size={16} color={Palette.blueDark} /></Pressable>
            <Pressable onPress={() => (kind === 'ebook' ? setPreviewPages(Math.min(10, previewPages + 1)) : setPreviewSeconds(Math.min(120, previewSeconds + 10)))} style={styles.step}><Ionicons name="add" size={16} color={Palette.blueDark} /></Pressable>
          </View>

          <Pressable onPress={() => setRights(!rights)} style={styles.rights}>
            <Ionicons name={rights ? 'checkbox' : 'square-outline'} size={22} color={Palette.blue} />
            <ThemedText type="small" style={styles.flex}>I own the rights to sell this content, or have the creator&apos;s written permission. I understand copyright complaints can remove it and my account.</ThemedText>
          </Pressable>

          <Pressable onPress={() => setInSubscription(!inSubscription)} style={styles.rights}>
            <Ionicons name={inSubscription ? 'checkbox' : 'square-outline'} size={22} color={Palette.blue} />
            <ThemedText type="small" style={styles.flex}>Include in my monthly subscription (subscribers can open it while their subscription is paid).</ThemedText>
          </Pressable>
          <Pressable onPress={() => router.push('/catalogue/digital/subscription' as never)} hitSlop={6}>
            <ThemedText type="smallBold" style={{ color: Palette.blue }}>Set up or change your monthly subscription →</ThemedText>
          </Pressable>

          <Pressable onPress={() => void save()} disabled={!!busy} style={[styles.secondary, busy === 'save' && styles.disabled]}>
            {busy === 'save' ? <ActivityIndicator color={Palette.blueDark} /> : <ThemedText type="smallBold" style={styles.secondaryText}>Save settings</ThemedText>}
          </Pressable>

          <ThemedText type="smallBold" style={styles.section}>Files</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{kindInfo.hint}. Files stay private: only buyers can open them, inside the app.</ThemedText>
          {files.map((f, i) => (
            <View key={f.id} style={[styles.fileRow, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name={kindInfo.icon} size={18} color={Palette.blue} />
              <View style={styles.flex}>
                <ThemedText type="smallBold" numberOfLines={1}>{f.title || `${kindInfo.label} ${i + 1}`}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {f.format.toUpperCase()} · {(f.bytes / 1048576).toFixed(1)} MB{f.pages ? ` · ${f.pages} ${f.kind === 'epub' ? 'sections' : 'pages'}` : ''}{f.duration_seconds ? ` · ${Math.round(f.duration_seconds / 60)} min` : ''} · {f.status}
                </ThemedText>
              </View>
              {!data.active_licenses ? <Pressable onPress={() => removeFile(f.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color={Palette.red} /></Pressable> : null}
            </View>
          ))}
          {kind !== 'ebook' || files.length === 0 ? (
            <>
              {kind !== 'ebook' ? <TextInput value={trackTitle} onChangeText={setTrackTitle} placeholder={kind === 'audio' ? 'Track title (optional)' : 'Lesson title (optional)'} placeholderTextColor={theme.textSecondary} style={field} /> : null}
              <Pressable onPress={() => void upload()} disabled={!!busy} style={[styles.secondary, busy === 'upload' && styles.disabled]}>
                {busy === 'upload' ? <ActivityIndicator color={Palette.blueDark} /> : (
                  <><Ionicons name="cloud-upload" size={18} color={Palette.blueDark} /><ThemedText type="smallBold" style={styles.secondaryText}>Upload {kind === 'ebook' ? 'PDF or EPUB' : kind === 'audio' ? 'a track' : 'a lesson'}</ThemedText></>
                )}
              </Pressable>
            </>
          ) : null}

          {['draft', 'rejected'].includes(status) ? (
            <Pressable onPress={() => void run('submit', () => submitSellerDigital(token!, itemId), 'Submitted. One Dream will review it before it goes on sale.')} disabled={!canSubmit || !!busy} style={[styles.primary, (!canSubmit || !!busy) && styles.disabled]}>
              {busy === 'submit' ? <ActivityIndicator color={Palette.lemonInk} /> : <ThemedText type="smallBold" style={styles.primaryText}>Submit for review</ThemedText>}
            </Pressable>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            Your earnings = price − the store or card fee (Google Play or Paystack) − One Dream&apos;s commission. Each sale is held briefly for refunds, then paid out by One Dream. See Wallet → Digital sales.
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
  section: { marginTop: Spacing.three },
  status: { borderRadius: 14, padding: Spacing.three, gap: 2, backgroundColor: Palette.ashSoft },
  statusLive: { backgroundColor: '#DCFCE7' },
  statusBad: { backgroundColor: Palette.redSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Palette.blueSoft },
  chipOn: { backgroundColor: Palette.blue },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  step: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.blueSoft },
  rights: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start', marginTop: Spacing.two },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
  primary: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: Palette.lemon, marginTop: Spacing.two },
  primaryText: { color: Palette.lemonInk, fontSize: 15 },
  secondary: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 12, backgroundColor: Palette.blueSoft },
  secondaryText: { color: Palette.blueDark },
  disabled: { opacity: 0.5 },
});
