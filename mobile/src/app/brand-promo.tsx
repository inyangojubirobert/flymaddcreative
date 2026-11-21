import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PasswordInput } from '@/components/password-input';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api-client';
import { useAdmin } from '@/contexts/AdminContext';

// Admin: brand promotion. Upload a picture or video with a link to one of our
// products; it shows in the app's ad slots (home, shop, search, category),
// labelled "From One Dream". Backed by /api/admin/house-ads (house ads).
// With "Show in all our apps" on, it goes to the Book of Memes brand network
// instead (/api/admin/brand/products, needs BRAND_NETWORK_KEY on the server),
// so it appears in One Dream, Book of Memes, TaskMaster and Oxygen - each app
// except the product's own.

const ADMIN_TOKEN_KEY = 'admin_alert_token'; // shared with the Admin alerts sign-in
let webToken: string | null = null;

async function readToken() {
  if (Platform.OS === 'web') return webToken;
  try { return await SecureStore.getItemAsync(ADMIN_TOKEN_KEY); } catch { return null; }
}
async function saveToken(token: string | null) {
  if (Platform.OS === 'web') { webToken = token; return; }
  try {
    if (token) await SecureStore.setItemAsync(ADMIN_TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(ADMIN_TOKEN_KEY);
  } catch { /* not stored: sign in again next time */ }
}

type Promo = {
  id: string;
  title: string;
  body: string | null;
  status: 'active' | 'paused' | 'archived';
  destination_url: string | null;
  resource_type: 'image' | 'video';
  preview: { url: string; poster: string | null };
  impressions: number;
  clicks: number;
};

type Signed = Record<'api_key' | 'timestamp' | 'signature' | 'folder' | 'public_id' | 'type' | 'allowed_formats' | 'upload_url', string> & { max_bytes: number; max_seconds: number | null };

type Picked = { uri: string; type: 'image' | 'video'; mimeType?: string | null; fileName?: string | null; fileSize?: number | null; duration?: number | null; file?: Blob | null };

type BrandAd = {
  id: string;
  name: string;
  headline: string;
  status: 'active' | 'paused' | 'archived';
  product_app: string | null;
  video_url: string | null;
  image_url: string | null;
  android_url: string | null;
  ios_url: string | null;
  web_url: string | null;
  views?: number;
  taps?: number;
  impressions?: number;
  clicks?: number;
};

const PRODUCTS = [
  { key: 'onedream', name: 'One Dream' },
  { key: 'bookofmemes', name: 'Book of Memes' },
  { key: 'taskmaster', name: 'Bascardo TaskMaster' },
  { key: 'oxygen', name: 'Bascardo Oxygen' },
  { key: '', name: 'Other product' },
] as const;
const ALL_APPS = ['onedream', 'bookofmemes', 'taskmaster', 'oxygen'];

/** A store link goes in the matching slot so each phone gets the right Download button. */
function linkFields(url: string) {
  if (/^https:\/\/play\.google\.com\//i.test(url)) return { android_url: url };
  if (/^https:\/\/(apps|itunes)\.apple\.com\//i.test(url)) return { ios_url: url };
  return { web_url: url };
}

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

export default function BrandPromoScreen() {
  const theme = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [media, setMedia] = useState<Picked | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cta, setCta] = useState('');
  const [link, setLink] = useState('');
  const [list, setList] = useState<Promo[]>([]);
  const [everywhere, setEverywhere] = useState(true);
  const [product, setProduct] = useState<string>('onedream');
  const [brandList, setBrandList] = useState<BrandAd[]>([]);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  const load = useCallback(async (t: string) => {
    try {
      const d = await apiFetch<{ house_ads: Promo[] }>('/api/admin/house-ads', { token: t });
      setList(d.house_ads);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { await saveToken(null); setToken(null); return; }
      setError(message(e, 'Could not load promotions'));
    }
    try {
      const b = await apiFetch<{ data?: BrandAd[]; products?: BrandAd[] }>('/api/admin/brand/products', { token: t });
      setBrandList((b.data || b.products || []).filter((x) => x.status !== 'archived'));
      setBrandError(null);
    } catch (e) {
      setBrandError(message(e, 'All-apps list unavailable'));
    }
  }, []);

  // Admins signed into the app (Admin tab) need no separate sign-in.
  const { adminToken } = useAdmin();
  useFocusEffect(useCallback(() => {
    if (adminToken) { setToken(adminToken); setChecking(false); void load(adminToken); return; }
    void readToken().then((t) => { setToken(t); setChecking(false); if (t) void load(t); });
  }, [load, adminToken]));

  async function signIn() {
    setBusy(true); setError(null);
    try {
      if (!email.trim() || !password) throw new Error('Enter the admin email and password.');
      const login = await apiFetch<{ token: string }>('/api/admin/login', { method: 'POST', body: { email: email.trim(), password } });
      setPassword('');
      await saveToken(login.token);
      setToken(login.token);
      await load(login.token);
    } catch (e) {
      setError(message(e, 'Sign-in failed'));
    } finally { setBusy(false); }
  }

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.85, allowsEditing: false, videoMaxDuration: 60 });
    const a = !result.canceled ? result.assets?.[0] : null;
    if (!a?.uri) return;
    setMedia({ uri: a.uri, type: a.type === 'video' ? 'video' : 'image', mimeType: a.mimeType, fileName: a.fileName, fileSize: a.fileSize, duration: a.duration, file: (a as { file?: Blob }).file ?? null });
  }

  async function publish() {
    if (!token) return;
    setError(null); setStatus(null);
    if (!media) { setError('Choose a picture or video.'); return; }
    if (title.trim().length < 2) { setError('Enter a title.'); return; }
    if (!/^https:\/\//i.test(link.trim())) { setError('The link must start with https:// (Play Store or website).'); return; }
    setBusy(true);
    try {
      setStatus('Uploading…');
      const { upload } = await apiFetch<{ upload: Signed }>('/api/admin/house-ads', { method: 'POST', token, body: { action: 'sign', resource_type: media.type } });
      if (media.fileSize && media.fileSize > upload.max_bytes) throw new Error(`File must be under ${Math.round(upload.max_bytes / 1048576)} MB`);
      if (media.type === 'video' && upload.max_seconds && media.duration && media.duration / 1000 > upload.max_seconds) {
        throw new Error(`Videos must be ${upload.max_seconds} seconds or shorter`);
      }
      const name = media.fileName || `promo-${Date.now()}.${media.type === 'video' ? 'mp4' : 'jpg'}`;
      const form = new FormData();
      if (Platform.OS === 'web') form.append('file', media.file ?? await (await fetch(media.uri)).blob(), name);
      else form.append('file', { uri: media.uri, name, type: media.mimeType || (media.type === 'video' ? 'video/mp4' : 'image/jpeg') } as never);
      for (const key of ['api_key', 'timestamp', 'signature', 'folder', 'public_id', 'type', 'allowed_formats'] as const) form.append(key, String(upload[key]));
      const sent = await fetch(upload.upload_url, { method: 'POST', body: form });
      const result = await sent.json().catch(() => ({})) as { public_id?: string; secure_url?: string; error?: { message?: string } };
      if (!sent.ok || !result.public_id) throw new Error(result.error?.message || 'Upload failed');
      setStatus('Publishing…');
      if (everywhere) {
        if (!result.secure_url) throw new Error('Upload gave no link');
        const chosen = PRODUCTS.find((x) => x.key === product);
        await apiFetch('/api/admin/brand/products', {
          method: 'POST', token,
          body: {
            name: product ? chosen?.name : title.trim().slice(0, 60),
            headline: title.trim(),
            body: body.trim() || undefined,
            [media.type === 'video' ? 'video_url' : 'image_url']: result.secure_url,
            ...linkFields(link.trim()),
            product_app: product || null,
            show_in: ALL_APPS,
            mode: 'fill',
          },
        });
        setStatus("Published to all our apps. It appears on their next refresh (not in the product's own app).");
        setMedia(null); setTitle(''); setBody(''); setCta(''); setLink('');
        await load(token);
        return;
      }
      await apiFetch('/api/admin/house-ads', {
        method: 'POST', token,
        body: {
          action: 'create', public_id: result.public_id, resource_type: media.type,
          title: title.trim(), body: body.trim() || undefined, cta_label: cta.trim() || undefined,
          destination_type: 'external', destination_url: link.trim(),
        },
      });
      setStatus('Published. It shows in the app on the next refresh.');
      setMedia(null); setTitle(''); setBody(''); setCta(''); setLink('');
      await load(token);
    } catch (e) {
      setStatus(null);
      setError(message(e, 'Could not publish'));
    } finally { setBusy(false); }
  }

  async function setBrandStatus(id: string, next: BrandAd['status']) {
    if (!token) return;
    try {
      await apiFetch(`/api/admin/brand/products/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: { status: next } });
      await load(token);
    } catch (e) { setError(message(e, 'Could not update')); }
  }

  async function setPromoStatus(id: string, next: Promo['status']) {
    if (!token) return;
    try {
      await apiFetch('/api/admin/house-ads', { method: 'PATCH', token, body: { id, status: next } });
      await load(token);
    } catch (e) { setError(message(e, 'Could not update')); }
  }

  if (checking) return <ThemedView style={styles.center}><ActivityIndicator /></ThemedView>;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Brand promotion' }} />
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!token ? (
            <>
              <ThemedText type="subtitle">Admin sign-in</ThemedText>
              <ThemedText themeColor="textSecondary">Only One Dream admins can promote our products.</ThemedText>
              <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Admin email" placeholderTextColor={theme.textSecondary} style={input} />
              <PasswordInput value={password} onChangeText={setPassword} placeholder="Password" />
              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
              <Pressable onPress={signIn} disabled={busy} style={styles.button}>
                {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Sign in</ThemedText>}
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="subtitle">Promote a product</ThemedText>
              <ThemedText themeColor="textSecondary">Shows in the ad slots, labelled &quot;From One Dream&quot;, whenever no paid ad is using the slot.</ThemedText>

              <Pressable onPress={() => setEverywhere(!everywhere)} style={[styles.toggle, { backgroundColor: theme.backgroundElement }]}>
                <View style={[styles.box, everywhere && styles.boxOn]}>{everywhere ? <ThemedText style={styles.tick}>✓</ThemedText> : null}</View>
                <View style={styles.flex}>
                  <ThemedText type="smallBold">Show in all our apps</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{everywhere ? "One Dream, Book of Memes, TaskMaster and Oxygen (never in the product's own app)." : 'Only in One Dream.'}</ThemedText>
                </View>
              </Pressable>
              {everywhere ? (
                <>
                  <ThemedText type="smallBold">Which product is this?</ThemedText>
                  <View style={styles.chips}>
                    {PRODUCTS.map((x) => (
                      <Pressable key={x.key || 'other'} onPress={() => setProduct(x.key)} style={[styles.chip, product === x.key && styles.chipOn]}>
                        <ThemedText type="small" style={product === x.key ? styles.chipTextOn : undefined}>{x.name}</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <Pressable onPress={pick} style={[styles.picker, { backgroundColor: theme.backgroundElement }]}>
                {media ? (
                  media.type === 'image'
                    ? <Image source={{ uri: media.uri }} style={styles.preview} resizeMode="cover" />
                    : <ThemedText type="smallBold">Video selected · tap to change</ThemedText>
                ) : <ThemedText type="smallBold" style={styles.linkText}>Choose picture or video</ThemedText>}
              </Pressable>
              <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder="Title, e.g. Get Book of Memes" placeholderTextColor={theme.textSecondary} style={input} />
              <TextInput value={body} onChangeText={setBody} maxLength={300} placeholder="Short text (optional)" placeholderTextColor={theme.textSecondary} style={input} multiline />
              <TextInput value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url" placeholder="Link: https://play.google.com/... or website" placeholderTextColor={theme.textSecondary} style={input} />
              <TextInput value={cta} onChangeText={setCta} maxLength={24} placeholder="Button label (optional), e.g. Download" placeholderTextColor={theme.textSecondary} style={input} />
              {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
              {status ? <ThemedText themeColor="textSecondary">{status}</ThemedText> : null}
              <Pressable onPress={publish} disabled={busy} style={styles.button}>
                {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Upload and publish</ThemedText>}
              </Pressable>

              <ThemedText type="smallBold" style={styles.section}>In all our apps</ThemedText>
              {brandError ? <ThemedText type="small" style={styles.error}>{brandError}</ThemedText> : brandList.length ? brandList.map((p) => (
                <View key={p.id} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
                  {p.image_url ? <Image source={{ uri: p.image_url }} style={styles.thumb} /> : <View style={[styles.thumb, styles.center]}><ThemedText type="small">Video</ThemedText></View>}
                  <View style={styles.flex}>
                    <ThemedText type="smallBold" numberOfLines={1}>{p.name}: {p.headline}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{p.android_url || p.ios_url || p.web_url || ''}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{p.status} · {p.views ?? p.impressions ?? 0} views · {p.taps ?? p.clicks ?? 0} taps (30 days)</ThemedText>
                    <View style={styles.actions}>
                      <Pressable onPress={() => setBrandStatus(p.id, p.status === 'active' ? 'paused' : 'active')}>
                        <ThemedText type="smallBold" style={styles.linkText}>{p.status === 'active' ? 'Pause' : 'Activate'}</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => setBrandStatus(p.id, 'archived')}>
                        <ThemedText type="smallBold" style={styles.error}>Remove</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              )) : <ThemedText themeColor="textSecondary">None yet.</ThemedText>}

              <ThemedText type="smallBold" style={styles.section}>Only in One Dream</ThemedText>
              {list.length ? list.map((p) => (
                <View key={p.id} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
                  <Image source={{ uri: p.resource_type === 'video' ? (p.preview.poster || p.preview.url) : p.preview.url }} style={styles.thumb} />
                  <View style={styles.flex}>
                    <ThemedText type="smallBold" numberOfLines={1}>{p.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{p.destination_url || ''}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{p.status} · {p.impressions} views · {p.clicks} taps</ThemedText>
                    <View style={styles.actions}>
                      <Pressable onPress={() => setPromoStatus(p.id, p.status === 'active' ? 'paused' : 'active')}>
                        <ThemedText type="smallBold" style={styles.linkText}>{p.status === 'active' ? 'Pause' : 'Activate'}</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => setPromoStatus(p.id, 'archived')}>
                        <ThemedText type="smallBold" style={styles.error}>Remove</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                </View>
              )) : <ThemedText themeColor="textSecondary">No promotions yet.</ThemedText>}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  picker: { borderRadius: 12, minHeight: 120, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  preview: { width: '100%', aspectRatio: 16 / 9 },
  button: { minHeight: 50, borderRadius: 14, backgroundColor: Palette.blue, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  linkText: { color: Palette.blue },
  error: { color: '#b91c1c' },
  section: { marginTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, borderRadius: 12, padding: Spacing.two },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#0002' },
  toggle: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', borderRadius: 12, padding: Spacing.three },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: Palette.blue, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: Palette.blue },
  tick: { color: '#fff', fontWeight: '800', lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: Palette.blue },
  chipOn: { backgroundColor: Palette.blue },
  chipTextOn: { color: '#fff' },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: 4 },
});
