import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { API_BASE_URL, ApiError } from '@/lib/api-client';
import {
  addTextCreative, createCollection, createLink, getCollections, getLinks, getMemberships, getPartner, setResalePrice,
  updateCollection, updatePartner, uploadCreative, type Membership,
} from '@/api/earnings';

// The partner's storefront, tracked links, collections and creatives.
// Everything a partner adds is reviewed before buyers see it; the seller's
// specifications, stock and delivery terms always come from the listing.

export default function PartnerStorefrontScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const partnerQ = useQuery({ queryKey: ['partner'], queryFn: () => getPartner(token!), enabled: !!token });
  const membershipsQ = useQuery({ queryKey: ['memberships'], queryFn: () => getMemberships(token!), enabled: !!token && !!partnerQ.data?.partner });
  const linksQ = useQuery({ queryKey: ['partner-links'], queryFn: () => getLinks(token!), enabled: !!token && !!partnerQ.data?.partner });
  const collectionsQ = useQuery({ queryKey: ['collections'], queryFn: () => getCollections(token!), enabled: !!token && !!partnerQ.data?.partner });
  const [bio, setBio] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState('');
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };
  const refresh = () => ['memberships', 'partner-links', 'collections', 'partner'].forEach((k) => void queryClient.invalidateQueries({ queryKey: [k] }));
  const fail = (e: unknown) => Alert.alert('Something went wrong', e instanceof ApiError ? e.message : 'Please try again.');

  if (partnerQ.isLoading) return <ActivityIndicator style={{ marginTop: Spacing.six }} />;
  const partner = partnerQ.data?.partner;
  if (!partner) {
    return (
      <ThemedView style={styles.container}>
        <Pressable onPress={() => router.replace('/partner' as never)} style={styles.empty}>
          <ThemedText>Join the partner programme first.</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }
  const storefrontLink = linksQ.data?.links.find((l) => l.target === 'storefront');
  const approved = (membershipsQ.data?.memberships ?? []).filter((m) => m.status === 'approved');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.section, card]}>
            <ThemedText type="smallBold">Your storefront</ThemedText>
            {storefrontLink ? (
              <View style={styles.row}>
                <ThemedText type="small" style={styles.flex} numberOfLines={1}>{storefrontLink.url}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{storefrontLink.clicks} visits</ThemedText>
                <Pressable onPress={() => void Share.share({ message: storefrontLink.url })}><Ionicons name="share-social" size={18} color={Palette.blue} /></Pressable>
              </View>
            ) : null}
            <Pressable onPress={() => router.push(`/m/${partner.handle}` as never)}>
              <ThemedText type="small" style={{ color: Palette.blue }}>Preview storefront</ThemedText>
            </Pressable>
            <TextInput value={bio ?? partner.bio ?? ''} onChangeText={setBio} placeholder="Storefront bio" placeholderTextColor={Palette.slate} multiline style={[styles.input, { color: theme.text, minHeight: 60 }]} />
            {bio !== null ? (
              <Pressable onPress={() => updatePartner(token!, { bio }).then(() => { setBio(null); refresh(); }, fail)} style={styles.small}>
                <ThemedText type="smallBold" style={{ color: Palette.white }}>Save bio</ThemedText>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.section, card]}>
            <ThemedText type="smallBold">Collections</ThemedText>
            {(collectionsQ.data?.collections ?? []).map((c) => (
              <View key={c.id} style={styles.collection}>
                <ThemedText type="small">{c.title} · {c.items.length} listing{c.items.length === 1 ? '' : 's'}</ThemedText>
                <View style={styles.chips}>
                  {approved.map((m) => {
                    const inside = c.items.some((i) => i.membership_id === m.id);
                    return (
                      <Pressable key={m.id} onPress={() => updateCollection(token!, { id: c.id, [inside ? 'remove' : 'add']: [m.id] }).then(refresh, fail)}
                        style={[styles.chip, inside && styles.chipOn]}>
                        <ThemedText type="small" style={inside ? { color: Palette.white } : undefined} numberOfLines={1}>{m.offer.item.title}</ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <View style={styles.row}>
              <TextInput value={newCollection} onChangeText={setNewCollection} placeholder="New collection name" placeholderTextColor={Palette.slate} style={[styles.input, styles.flex, { color: theme.text }]} />
              <Pressable onPress={() => newCollection.trim() && createCollection(token!, newCollection.trim()).then(() => { setNewCollection(''); refresh(); }, fail)} style={styles.small}>
                <ThemedText type="smallBold" style={{ color: Palette.white }}>Add</ThemedText>
              </Pressable>
            </View>
          </View>

          <ThemedText type="smallBold" style={styles.label}>YOUR PARTNERSHIPS</ThemedText>
          {membershipsQ.isLoading ? <ActivityIndicator /> : (membershipsQ.data?.memberships ?? []).map((m) => (
            <MembershipCard key={m.id} m={m} onChanged={refresh} onError={fail} />
          ))}
          {!membershipsQ.isLoading && !(membershipsQ.data?.memberships ?? []).length ? (
            <Pressable onPress={() => router.push('/partner/discover' as never)}>
              <ThemedText type="small" style={{ color: Palette.blue }}>No partnerships yet - find listings to promote</ThemedText>
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function MembershipCard({ m, onChanged, onError }: { m: Membership; onChanged: () => void; onError: (e: unknown) => void }) {
  const { token } = useAuth();
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [price, setPrice] = useState(m.resale_price_usd ? String(m.resale_price_usd) : '');
  const image = Array.isArray(m.offer.item.images) ? m.offer.item.images[0] : null;

  async function pick(type: 'image' | 'video') {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: [type === 'video' ? 'videos' : 'images'], quality: 0.9, allowsEditing: type === 'image' });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setBusy(type);
    try {
      await uploadCreative(token!, m.id, { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName, type, file: (asset as { file?: Blob }).file ?? null });
      Alert.alert('Uploaded', 'Your creative is waiting for review.');
      onChanged();
    } catch (e) { onError(e); } finally { setBusy(null); }
  }

  async function link() {
    setBusy('link');
    try {
      const r = await createLink(token!, { target: 'membership', membership_id: m.id });
      await Clipboard.setStringAsync(r.link.url);
      Alert.alert('Link copied', r.link.url);
      onChanged();
    } catch (e) { onError(e); } finally { setBusy(null); }
  }

  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.row}>
        {image ? <Image source={{ uri: image }} style={styles.thumb} /> : null}
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={1}>{m.offer.item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{m.model} · {m.status} · @{m.offer.item.seller_username}</ThemedText>
        </View>
      </View>
      {m.status === 'approved' ? (
        <>
          {m.links.map((l) => (
            <Pressable key={l.id} onPress={() => void Clipboard.setStringAsync(`${API_BASE_URL}/r/${l.code}`)} style={styles.row}>
              <ThemedText type="small" style={styles.flex}>/r/{l.code}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{l.clicks} clicks · copy</ThemedText>
            </Pressable>
          ))}
          <View style={styles.row}>
            <Small label={busy === 'link' ? '…' : 'New link'} onPress={link} />
            <Small label={busy === 'image' ? 'Uploading…' : '+ Photo'} onPress={() => pick('image')} />
            <Small label={busy === 'video' ? 'Uploading…' : '+ Video'} onPress={() => pick('video')} />
          </View>
          <View style={styles.row}>
            <TextInput value={text} onChangeText={setText} placeholder="Your own description" placeholderTextColor={Palette.slate} multiline style={[styles.input, styles.flex, { color: theme.text }]} />
            <Small label="Add" onPress={() => text.trim().length >= 10
              ? addTextCreative(token!, m.id, m.offer.item.title, text.trim()).then(() => { setText(''); onChanged(); }, onError)
              : Alert.alert('Too short', 'Write at least a sentence.')} />
          </View>
          {m.model === 'resale' ? (
            <View style={styles.row}>
              <ThemedText type="small">Your price $</ThemedText>
              <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={[styles.input, { width: 90, color: theme.text }]} />
              <Small label="Update" onPress={() => setResalePrice(token!, m.id, Number(price)).then(onChanged, onError)} />
            </View>
          ) : null}
          {m.creatives.map((c) => (
            <ThemedText key={c.id} type="small" themeColor="textSecondary">
              {c.kind} {c.title ? `“${c.title}”` : ''} · {c.status}{c.reject_reason ? ` - ${c.reject_reason}` : ''}
            </ThemedText>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Small({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.small}>
      <ThemedText type="smallBold" style={{ color: Palette.white }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { padding: Spacing.four, alignItems: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  label: { color: Palette.slate, letterSpacing: 0.6, marginBottom: -Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  flex: { flex: 1 },
  input: { borderWidth: 1, borderColor: Palette.ash, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 8 },
  small: { backgroundColor: Palette.blue, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  collection: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: Palette.ashSoft, maxWidth: 180 },
  chipOn: { backgroundColor: Palette.blue },
  thumb: { width: 48, height: 48, borderRadius: 8 },
});
