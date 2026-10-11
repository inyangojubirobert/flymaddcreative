import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PromoStoreProvider, type PromoStore } from '@/components/promo-billing';
import {
  deleteAdMedia, formatDuration, getAdMedia, getAdPackages, getMyAds, uploadAdMedia,
  type AdCampaign, type AdEntitlement, type AdMedia, type AdPackage, type CampaignState,
} from '@/api/ads';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

type Tab = 'packages' | 'campaigns' | 'media';

const STATE_BADGE: Record<CampaignState, { label: string; bg: string; ink: string }> = {
  draft: { label: 'Draft', bg: Palette.ashSoft, ink: Palette.slate },
  pending_review: { label: 'In review', bg: Palette.yellowSoft, ink: Palette.yellowInk },
  active: { label: 'Live', bg: '#DCFCE7', ink: Palette.green },
  paused: { label: 'Paused', bg: Palette.ashSoft, ink: Palette.slate },
  rejected: { label: 'Needs changes', bg: Palette.redSoft, ink: Palette.red },
  suspended: { label: 'Suspended', bg: Palette.redSoft, ink: Palette.red },
  revoked: { label: 'Ended (refunded)', bg: Palette.ashSoft, ink: Palette.slate },
  completed: { label: 'Completed', bg: Palette.blueSoft, ink: Palette.blueDark },
};

const MEDIA_BADGE: Record<AdMedia['status'], { label: string; ink: string }> = {
  pending: { label: 'Awaiting review', ink: Palette.yellowInk },
  approved: { label: 'Approved', ink: Palette.green },
  rejected: { label: 'Rejected', ink: Palette.red },
  removed: { label: 'Removed', ink: Palette.slate },
};

export default function PromoteScreen() {
  const [tab, setTab] = useState<Tab>('packages');
  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Promote' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.tabs}>
          <TabButton label="Packages" icon="pricetags" selected={tab === 'packages'} onPress={() => setTab('packages')} />
          <TabButton label="Campaigns" icon="megaphone" selected={tab === 'campaigns'} onPress={() => setTab('campaigns')} />
          <TabButton label="Media" icon="images" selected={tab === 'media'} onPress={() => setTab('media')} />
        </View>
        {tab === 'packages' ? <PackagesTab /> : tab === 'campaigns' ? <CampaignsTab /> : <MediaTab />}
      </SafeAreaView>
    </ThemedView>
  );
}

// --------------------------------------------------------------------------
// Packages + your unused packages
// --------------------------------------------------------------------------

function PackagesTab() {
  const { token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const packagesQuery = useQuery({ queryKey: ['ad-packages'], queryFn: getAdPackages });
  const mineQuery = useQuery({ queryKey: ['my-ads'], queryFn: () => getMyAds(token!), enabled: !!token });

  const packages = packagesQuery.data?.packages ?? [];
  const entitlements = mineQuery.data?.entitlements ?? [];
  const available = entitlements.filter((e) => e.status === 'available');
  const paused = !!packagesQuery.data?.billing?.paused;
  const anyPurchasable = packages.some((p) => p.purchasable);
  const useStore = Platform.OS === 'android' && anyPurchasable;

  const content = (store: PromoStore | null) => (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={packagesQuery.isFetching} onRefresh={() => { void packagesQuery.refetch(); void mineQuery.refetch(); }} />}
    >
      {available.length ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Your packages</ThemedText>
          {available.map((e) => (
            <Pressable key={e.id} onPress={() => router.push({ pathname: '/promote/campaign', params: { entitlementId: e.id } } as never)} style={styles.ownedRow}>
              <Ionicons name={e.package.kind === 'boost' ? 'rocket' : 'megaphone'} size={18} color={Palette.lemonInk} />
              <View style={styles.flex}>
                <ThemedText type="smallBold" style={{ color: Palette.lemonInk }}>{e.package.name} · {formatDuration(e.package.duration_hours)}</ThemedText>
                <ThemedText type="small" style={{ color: Palette.lemonInk }}>Ready to use - tap to create your {e.package.kind === 'boost' ? 'boost' : 'campaign'}</ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Palette.lemonInk} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {paused ? (
        <View style={styles.notice}>
          <Ionicons name="pause-circle" size={18} color={Palette.blueDark} />
          <ThemedText type="small" style={styles.noticeText}>Buying packages is paused for a moment. Your packages and campaigns are not affected.</ThemedText>
        </View>
      ) : null}
      {anyPurchasable && Platform.OS !== 'android' ? (
        <View style={styles.notice}>
          <Ionicons name="logo-google-playstore" size={18} color={Palette.blueDark} />
          <ThemedText type="small" style={styles.noticeText}>Packages are bought in the One Dream Android app. Campaigns you create there appear here too.</ThemedText>
        </View>
      ) : null}

      {packagesQuery.isLoading ? <ActivityIndicator style={styles.loading} /> : (
        <>
          <ThemedText type="subtitle">Advertising</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Images or videos in sponsored placements, linking to your website, shop or a listing.</ThemedText>
          {packages.filter((p) => p.kind === 'ad').map((pkg) => <PackageCard key={pkg.id} pkg={pkg} store={store} />)}
          <ThemedText type="subtitle" style={styles.sectionGap}>Listing boosts</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Lift one of your existing listings in the shop. Priced per listing.</ThemedText>
          {packages.filter((p) => p.kind === 'boost').map((pkg) => <PackageCard key={pkg.id} pkg={pkg} store={store} />)}
          {entitlements.length ? <PurchaseHistory entitlements={entitlements} /> : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionGap}>
            Promoted content is labelled Sponsored. Placement is shared fairly between advertisers by priority; sales, clicks and a fixed number of views are not guaranteed. Your time starts when the campaign goes live.
          </ThemedText>
        </>
      )}
    </ScrollView>
  );

  if (!useStore) return content(null);
  return (
    <PromoStoreProvider packages={packages} onGranted={() => void queryClient.invalidateQueries({ queryKey: ['my-ads'] })}>
      {(store) => content(store)}
    </PromoStoreProvider>
  );
}

function PackageCard({ pkg, store }: { pkg: AdPackage; store: PromoStore | null }) {
  const theme = useTheme();
  const popular = !!pkg.highlight;
  const playPrice = store?.priceFor(pkg);
  const canBuy = !!store && pkg.purchasable && !!playPrice;
  const busy = store?.busyPackageId === pkg.id;
  // Each package is independent: one not yet set up in Play Console doesn't block the others.
  const label = canBuy ? `Buy · ${playPrice}`
    : !pkg.purchasable ? 'Not available right now'
      : Platform.OS !== 'android' ? 'Buy in the Android app'
        : !store?.ready ? 'Connecting to Google Play…'
          : 'Awaiting Google Play configuration';

  return (
    <View style={[styles.pkg, { backgroundColor: theme.backgroundElement, borderColor: popular ? Palette.lemonInk : theme.backgroundSelected }, popular && styles.pkgPopular]}>
      {popular ? <View style={styles.highlight}><ThemedText style={styles.highlightText}>{pkg.highlight}</ThemedText></View> : null}
      <View style={styles.pkgHead}>
        <View style={styles.flex}>
          <ThemedText type="smallBold" style={styles.pkgName}>{pkg.name}</ThemedText>
          {pkg.tagline ? <ThemedText type="small" themeColor="textSecondary">{pkg.tagline}</ThemedText> : null}
        </View>
        <View style={styles.priceBox}>
          <ThemedText style={styles.price}>${pkg.price_usd % 1 ? pkg.price_usd.toFixed(2) : pkg.price_usd}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{formatDuration(pkg.duration_hours)}</ThemedText>
        </View>
      </View>
      {pkg.benefits.map((benefit) => (
        <View key={benefit} style={styles.benefit}>
          <Ionicons name="checkmark-circle" size={16} color={Palette.green} />
          <ThemedText type="small" style={styles.flex}>{benefit}</ThemedText>
        </View>
      ))}
      <Pressable
        onPress={() => store?.buy(pkg)}
        disabled={!canBuy || busy}
        style={[styles.buy, popular && styles.buyPopular, (!canBuy || busy) && styles.disabled]}
      >
        {busy ? <ActivityIndicator color={Palette.lemonInk} /> : <ThemedText type="smallBold" style={popular ? { color: Palette.lemonInk } : styles.buyText}>{label}</ThemedText>}
      </Pressable>
    </View>
  );
}

const ENTITLEMENT_LABEL: Record<AdEntitlement['status'], string> = {
  available: 'Ready to use',
  used: 'Used for a campaign',
  refunded: 'Refunded',
  revoked: 'Revoked',
};

function PurchaseHistory({ entitlements }: { entitlements: AdEntitlement[] }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, styles.sectionGap]}>
      <ThemedText type="smallBold">Purchase history</ThemedText>
      {entitlements.map((e) => (
        <View key={e.id} style={[styles.historyRow, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">{e.package.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(e.created_at).toLocaleDateString()} · {e.is_paid ? `Google Play${e.order_id ? ` · ${e.order_id}` : ''}` : 'Granted by One Dream'}
            </ThemedText>
            {e.revoke_reason ? <ThemedText type="small" style={{ color: Palette.red }}>{e.revoke_reason}</ThemedText> : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">{ENTITLEMENT_LABEL[e.status]}</ThemedText>
        </View>
      ))}
    </View>
  );
}

// --------------------------------------------------------------------------
// Campaigns
// --------------------------------------------------------------------------

function CampaignsTab() {
  const { token } = useAuth();
  const router = useRouter();
  const query = useQuery({ queryKey: ['my-ads'], queryFn: () => getMyAds(token!), enabled: !!token });
  const campaigns = query.data?.campaigns ?? [];
  return (
    <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
      {query.isLoading ? <ActivityIndicator style={styles.loading} /> : campaigns.length ? campaigns.map((c) => (
        <CampaignRow key={c.id} campaign={c} onPress={() => router.push({ pathname: '/promote/campaign', params: { campaignId: c.id } } as never)} />
      )) : (
        <ThemedText themeColor="textSecondary" style={styles.empty}>No campaigns yet. Buy a package, then create an ad or boost one of your listings.</ThemedText>
      )}
    </ScrollView>
  );
}

function CampaignRow({ campaign, onPress }: { campaign: AdCampaign; onPress: () => void }) {
  const theme = useTheme();
  const badge = STATE_BADGE[campaign.state];
  const ctr = campaign.impressions ? `${((campaign.clicks / campaign.impressions) * 100).toFixed(1)}%` : '—';
  const thumb = campaign.media[0];
  return (
    <Pressable onPress={onPress} style={[styles.campaign, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.campaignHead}>
        {thumb?.url ? <Image source={{ uri: thumb.poster || thumb.url }} style={styles.thumb} /> : (
          <View style={[styles.thumb, styles.thumbIcon]}><Ionicons name={campaign.kind === 'boost' ? 'rocket' : 'megaphone'} size={20} color={Palette.slate} /></View>
        )}
        <View style={styles.flex}>
          <ThemedText type="smallBold" numberOfLines={1}>{campaign.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {campaign.kind === 'boost' ? `Boost · ${campaign.listing_title || 'listing'}` : campaign.package_id.replace('_', ' ')}
          </ThemedText>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}><ThemedText type="smallBold" style={[styles.badgeText, { color: badge.ink }]}>{badge.label}</ThemedText></View>
      </View>
      <View style={styles.stats}>
        <Stat label="Impressions" value={campaign.impressions.toLocaleString()} />
        <Stat label="Clicks" value={campaign.clicks.toLocaleString()} />
        <Stat label="CTR" value={ctr} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {campaign.starts_at && campaign.ends_at
          ? `${new Date(campaign.starts_at).toLocaleDateString()} – ${new Date(campaign.ends_at).toLocaleDateString()}`
          : campaign.state === 'pending_review' ? 'Starts when approved' : 'Not started'}
      </ThemedText>
      {campaign.review_note && ['rejected', 'suspended', 'revoked'].includes(campaign.state) ? (
        <ThemedText type="small" style={{ color: Palette.red }}>{campaign.review_note}</ThemedText>
      ) : null}
    </Pressable>
  );
}

// --------------------------------------------------------------------------
// Media library
// --------------------------------------------------------------------------

function MediaTab() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['ad-media'], queryFn: () => getAdMedia(token!), enabled: !!token });
  const [uploading, setUploading] = useState<'image' | 'video' | null>(null);

  async function pickAndUpload(type: 'image' | 'video') {
    if (!token) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: [type === 'video' ? 'videos' : 'images'], quality: 0.9, allowsEditing: type === 'image' });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setUploading(type);
    try {
      await uploadAdMedia(token, { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName, fileSize: asset.fileSize, duration: asset.duration, type });
      void queryClient.invalidateQueries({ queryKey: ['ad-media'] });
    } catch (error) {
      Alert.alert('Upload failed', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setUploading(null);
    }
  }

  function remove(media: AdMedia) {
    Alert.alert('Delete this media?', 'It will be removed from One Dream and Cloudinary.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteAdMedia(token!, media.id);
            void queryClient.invalidateQueries({ queryKey: ['ad-media'] });
          } catch (error) {
            Alert.alert('Not deleted', error instanceof ApiError ? error.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />}>
      <View style={styles.uploadRow}>
        <Pressable onPress={() => void pickAndUpload('image')} disabled={!!uploading} style={[styles.upload, !!uploading && styles.disabled]}>
          {uploading === 'image' ? <ActivityIndicator color={Palette.blueDark} /> : <><Ionicons name="image" size={18} color={Palette.blueDark} /><ThemedText type="smallBold" style={styles.uploadText}>Upload image</ThemedText></>}
        </Pressable>
        <Pressable onPress={() => void pickAndUpload('video')} disabled={!!uploading} style={[styles.upload, !!uploading && styles.disabled]}>
          {uploading === 'video' ? <ActivityIndicator color={Palette.blueDark} /> : <><Ionicons name="videocam" size={18} color={Palette.blueDark} /><ThemedText type="smallBold" style={styles.uploadText}>Upload video</ThemedText></>}
        </Pressable>
      </View>
      <ThemedText type="small" themeColor="textSecondary">JPG, PNG or WebP up to 10 MB. MP4, MOV or WebM videos up to 100 MB and 60 seconds. New media stays private until One Dream approves it, and can be reused across campaigns.</ThemedText>
      {query.isLoading ? <ActivityIndicator style={styles.loading} /> : (
        <View style={styles.grid}>
          {(query.data ?? []).map((m) => (
            <Pressable key={m.id} onLongPress={() => remove(m)} style={[styles.tile, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
              {m.url ? <Image source={{ uri: m.poster || m.url }} style={styles.tileImage} /> : <View style={[styles.tileImage, styles.thumbIcon]}><Ionicons name="image" size={22} color={Palette.slate} /></View>}
              {m.resource_type === 'video' ? <View style={styles.videoTag}><Ionicons name="videocam" size={11} color="#fff" /><ThemedText style={styles.videoTagText}>{m.duration_seconds ? `${Math.round(m.duration_seconds)}s` : 'Video'}</ThemedText></View> : null}
              <ThemedText type="smallBold" style={[styles.tileStatus, { color: MEDIA_BADGE[m.status].ink }]}>{MEDIA_BADGE[m.status].label}</ThemedText>
              {m.reject_reason ? <ThemedText type="small" style={styles.tileReason} numberOfLines={2}>{m.reject_reason}</ThemedText> : null}
            </Pressable>
          ))}
        </View>
      )}
      {query.data?.length ? <ThemedText type="small" themeColor="textSecondary">Long-press an item to delete it.</ThemedText> : null}
    </ScrollView>
  );
}

// --------------------------------------------------------------------------

function TabButton({ label, icon, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, selected && styles.tabSelected]} accessibilityRole="tab" accessibilityState={{ selected }}>
      <Ionicons name={icon} size={15} color={selected ? Palette.white : Palette.blueDark} />
      <ThemedText type="smallBold" style={{ color: selected ? Palette.white : Palette.blueDark }}>{label}</ThemedText>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  flex: { flex: 1 },
  tabs: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.three },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 999, paddingVertical: 10, backgroundColor: Palette.blueSoft },
  tabSelected: { backgroundColor: Palette.blue },
  scroll: { paddingTop: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  loading: { marginTop: Spacing.five },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  section: { gap: Spacing.two },
  sectionGap: { marginTop: Spacing.three },
  ownedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 16, padding: Spacing.three, backgroundColor: Palette.lemon },
  notice: { flexDirection: 'row', gap: Spacing.two, borderRadius: 14, padding: Spacing.three, backgroundColor: Palette.blueSoft },
  noticeText: { flex: 1, color: Palette.blueDark },
  pkg: { borderRadius: 20, borderWidth: 1, padding: Spacing.three, gap: 8 },
  pkgPopular: { borderWidth: 2 },
  highlight: { position: 'absolute', right: 14, top: -11, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: Palette.lemon, borderWidth: 1, borderColor: Palette.lemonInk },
  highlightText: { color: Palette.lemonInk, fontSize: 11, lineHeight: 14, fontWeight: '800' },
  pkgHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  pkgName: { fontSize: 17 },
  priceBox: { alignItems: 'flex-end' },
  price: { fontSize: 26, lineHeight: 30, fontWeight: '800', color: Palette.blueDark },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buy: { marginTop: 4, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Palette.blue },
  buyPopular: { backgroundColor: Palette.lemon },
  buyText: { color: Palette.white },
  disabled: { opacity: 0.55 },
  campaign: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1, padding: Spacing.three },
  campaignHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  thumb: { width: 48, height: 48, borderRadius: 12 },
  thumbIcon: { backgroundColor: Palette.ashSoft, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 11 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, borderRadius: 12, padding: Spacing.two, backgroundColor: Palette.ashSoft, alignItems: 'center' },
  uploadRow: { flexDirection: 'row', gap: Spacing.two },
  upload: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderRadius: 14, backgroundColor: Palette.blueSoft },
  uploadText: { color: Palette.blueDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { width: '48%', borderRadius: 14, borderWidth: 1, overflow: 'hidden', paddingBottom: Spacing.two },
  tileImage: { width: '100%', aspectRatio: 1 },
  tileStatus: { paddingHorizontal: Spacing.two, paddingTop: Spacing.two, fontSize: 12 },
  tileReason: { paddingHorizontal: Spacing.two, color: Palette.red },
  videoTag: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: 'rgba(15,23,42,0.72)' },
  videoTagText: { color: '#fff', fontSize: 10, lineHeight: 13 },
});
