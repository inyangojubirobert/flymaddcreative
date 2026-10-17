import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';
import { merchantTokenStorage } from '@/lib/secure-storage';
import { enrolPartner, getPartner, linkMerchant } from '@/api/earnings';

// Partner programme hub: the four ways to earn from other sellers' listings,
// enrolment, the partner's storefront link, and every partner tool.

const WAYS = [
  { icon: 'link', title: 'Referral links', body: 'Share a tracked link to a listing and earn the seller\'s commission on completed sales.' },
  { icon: 'storefront', title: 'Your own storefront', body: 'Curate listings from many sellers with your own photos, videos and words.' },
  { icon: 'pricetags', title: 'Authorised reselling', body: 'Sell a listing at your own price above the seller\'s minimum and keep the margin.' },
  { icon: 'color-palette', title: 'Creative services', body: 'Sell photography, video and campaigns to sellers, with optional sales bonuses.' },
] as const;

export default function PartnerHubScreen() {
  const { token, participant } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['partner'], queryFn: () => getPartner(token!), enabled: !!token });
  const [handle, setHandle] = useState(participant?.username?.toLowerCase().replace(/[^a-z0-9_-]/g, '') || '');
  const [name, setName] = useState(participant?.name || '');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };
  const data = query.data;

  async function enrol() {
    if (!token) return;
    setBusy(true);
    try {
      await enrolPartner(token, { handle: handle.trim().toLowerCase(), display_name: name.trim(), bio: bio.trim() || undefined });
      void queryClient.invalidateQueries({ queryKey: ['partner'] });
    } catch (e) {
      Alert.alert('Not joined', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function linkMerchantAccount() {
    const merchantToken = await merchantTokenStorage.get().catch(() => null);
    if (!merchantToken) {
      Alert.alert('Sign in as a merchant first', 'Open Merchant, sign in, then come back here to link the two accounts.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Open Merchant', onPress: () => router.push('/merchant/login' as never) },
      ]);
      return;
    }
    try {
      await linkMerchant(token!, merchantToken);
      void queryClient.invalidateQueries({ queryKey: ['partner'] });
      Alert.alert('Linked', 'Your merchant earnings now show alongside your partner earnings.');
    } catch (e) {
      Alert.alert('Not linked', e instanceof ApiError ? e.message : 'Please try again.');
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">
            Earn by selling other people&apos;s products - without holding stock. Sellers choose which listings are open to partners and on what terms.
          </ThemedText>
          <View style={styles.ways}>
            {WAYS.map((w) => (
              <View key={w.title} style={[styles.way, card]}>
                <Ionicons name={w.icon} size={20} color={Palette.blue} />
                <ThemedText type="smallBold">{w.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{w.body}</ThemedText>
              </View>
            ))}
          </View>

          {query.isLoading ? <ActivityIndicator /> : !data?.partner ? (
            <View style={[styles.section, card]}>
              <ThemedText type="smallBold">Become a partner</ThemedText>
              <TextInput value={handle} onChangeText={(v) => setHandle(v.toLowerCase())} placeholder="storefront handle" placeholderTextColor={Palette.slate}
                autoCapitalize="none" style={[styles.input, { color: theme.text }]} />
              <ThemedText type="small" themeColor="textSecondary">Your storefront: flymaddcreative.online/m/{handle || 'yourname'}</ThemedText>
              <TextInput value={name} onChangeText={setName} placeholder="Display name" placeholderTextColor={Palette.slate} style={[styles.input, { color: theme.text }]} />
              <TextInput value={bio} onChangeText={setBio} placeholder="Short bio (optional)" placeholderTextColor={Palette.slate} multiline style={[styles.input, { color: theme.text, minHeight: 60 }]} />
              <Pressable onPress={enrol} disabled={busy} style={[styles.primary, busy && styles.disabled]}>
                <ThemedText style={styles.primaryText}>{busy ? 'Joining…' : 'Join the partner programme'}</ThemedText>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={[styles.section, card]}>
                <ThemedText type="subtitle">{data.partner.display_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">@{data.partner.handle} · {data.partner.status}</ThemedText>
                {data.storefront_url ? (
                  <View style={styles.row}>
                    <ThemedText type="small" numberOfLines={1} style={styles.flex}>{data.storefront_url}</ThemedText>
                    <Pressable onPress={() => void Clipboard.setStringAsync(data.storefront_url!)}><Ionicons name="copy" size={18} color={Palette.blue} /></Pressable>
                    <Pressable onPress={() => void Share.share({ message: data.storefront_url! })}><Ionicons name="share-social" size={18} color={Palette.blue} /></Pressable>
                  </View>
                ) : null}
                {data.merchant_link ? (
                  <ThemedText type="small" themeColor="textSecondary">Linked merchant account: {data.merchant_link.merchant_name}</ThemedText>
                ) : (
                  <Pressable onPress={linkMerchantAccount}><ThemedText type="small" style={{ color: Palette.blue }}>Have a merchant account? Link it</ThemedText></Pressable>
                )}
              </View>
              {[
                ['search', 'Find listings to promote', 'Offers from sellers, with what each sale earns', '/partner/discover'],
                ['storefront', 'My storefront, links & creatives', 'Collections, tracked links, your own photos and videos', '/partner/storefront'],
                ['briefcase', 'Creative engagements', 'Briefs and deliveries for creative services', '/partner/engagements'],
                ['wallet', 'Earnings & withdrawals', 'Commission, margins, gifts and referrals', '/earnings'],
              ].map(([icon, title, sub, href]) => (
                <Pressable key={href} onPress={() => router.push(href as never)} style={[styles.nav, card]}>
                  <Ionicons name={icon as never} size={20} color={Palette.blue} />
                  <View style={styles.flex}>
                    <ThemedText type="smallBold">{title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Palette.slate} />
                </Pressable>
              ))}
            </>
          )}

          <Pressable onPress={() => router.push('/partner/seller' as never)} style={[styles.nav, card]}>
            <Ionicons name="people" size={20} color={Palette.green} />
            <View style={styles.flex}>
              <ThemedText type="smallBold">Sell through partners</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Open your own listings to partners and approve requests</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Palette.slate} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  ways: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  way: { width: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: 4 },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  input: { borderWidth: 1, borderColor: Palette.ash, borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 8 },
  primary: { backgroundColor: Palette.blue, borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center' },
  primaryText: { color: Palette.white, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nav: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 14, padding: Spacing.three },
  flex: { flex: 1 },
});
