import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  createCampaign, deleteCampaign, formatDuration, getAdMedia, getMyAds, submitCampaign, updateCampaign,
  type AdEntitlement, type CampaignInput,
} from '@/api/ads';
import { getCatalogueByUsername } from '@/api/catalogue';
import { getMemberships } from '@/api/earnings';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

type Destination = 'external' | 'listing' | 'profile';

export default function CampaignEditorScreen() {
  const params = useLocalSearchParams<{ entitlementId?: string; campaignId?: string; listingId?: string }>();
  const { token, participant } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const adsQuery = useQuery({ queryKey: ['my-ads'], queryFn: () => getMyAds(token!), enabled: !!token });
  const mediaQuery = useQuery({ queryKey: ['ad-media'], queryFn: () => getAdMedia(token!), enabled: !!token });
  const listingsQuery = useQuery({
    queryKey: ['my-catalogue', participant?.username],
    queryFn: () => getCatalogueByUsername(participant!.username),
    enabled: !!participant?.username,
  });
  // P4: partners can also promote listings they are an approved partner for.
  const partnerQuery = useQuery({
    queryKey: ['affiliate-memberships'],
    queryFn: () => getMemberships(token!),
    enabled: !!token,
    retry: false,
  });

  const campaign = adsQuery.data?.campaigns.find((c) => c.id === params.campaignId) ?? null;
  const entitlement: AdEntitlement | null = useMemo(() => {
    const list = adsQuery.data?.entitlements ?? [];
    return list.find((e) => e.id === (campaign?.entitlement_id ?? params.entitlementId)) ?? null;
  }, [adsQuery.data, campaign, params.entitlementId]);
  const pkg = entitlement?.package;
  const isBoost = (campaign?.kind ?? pkg?.kind) === 'boost';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cta, setCta] = useState('');
  const [destination, setDestination] = useState<Destination>('listing');
  const [url, setUrl] = useState('');
  const [listingId, setListingId] = useState<string | null>(params.listingId ?? null);
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !adsQuery.data) return;
    if (campaign) {
      setTitle(campaign.title);
      setBody(campaign.body ?? '');
      setCta(campaign.cta_label ?? '');
      setDestination(campaign.destination_type);
      setUrl(campaign.destination_url ?? '');
      setListingId(campaign.listing_id);
      setMediaIds(campaign.media.map((m) => m.id));
    } else if (pkg) {
      setDestination(pkg.kind === 'boost' ? 'listing' : pkg.allow_external_link ? 'external' : 'listing');
    }
    setLoaded(true);
  }, [adsQuery.data, campaign, pkg, loaded]);

  const editable = !campaign || ['draft', 'rejected', 'pending_review', 'paused'].includes(campaign.status) || (campaign.status === 'active' && !isBoost && campaign.state !== 'completed');
  const ownListings = (listingsQuery.data ?? []).filter((item) => item.status === 'active');
  const partnerListings = (partnerQuery.data?.memberships ?? [])
    .filter((m) => m.status === 'approved' && m.offer?.status === 'active' && m.offer.item && !ownListings.some((item) => item.id === m.offer.item.id))
    .map((m) => ({ id: m.offer.item.id, title: `${m.offer.item.title} · partner listing`, images: m.offer.item.images }));
  const liveListings: { id: string; title: string; images?: string[] | null }[] = [...ownListings, ...partnerListings];
  const library = (mediaQuery.data ?? []).filter((m) => m.status !== 'rejected');
  const maxCreatives = pkg?.max_creatives ?? 0;

  function input(): CampaignInput {
    const selectedListing = liveListings.find((item) => item.id === listingId);
    return {
      title: (title || (isBoost && selectedListing ? selectedListing.title : '')).trim(),
      body: body.trim() || null,
      cta_label: cta.trim() || null,
      destination_type: isBoost ? 'listing' : destination,
      destination_url: destination === 'external' && !isBoost ? url.trim() : null,
      listing_id: isBoost || destination === 'listing' ? listingId : null,
      media_ids: isBoost ? [] : mediaIds,
    };
  }

  async function save(andSubmit: boolean) {
    if (!token || !entitlement) return;
    setBusy(true);
    try {
      const id = campaign
        ? (await updateCampaign(token, campaign.id, input())).id
        : (await createCampaign(token, { ...input(), entitlement_id: entitlement.id })).id;
      let message = campaign?.status === 'active' ? 'Saved. Your changes go to review; the campaign pauses until approved.' : 'Draft saved.';
      if (andSubmit && (!campaign || campaign.status !== 'active')) {
        const result = await submitCampaign(token, id);
        message = result.message;
      }
      await queryClient.invalidateQueries({ queryKey: ['my-ads'] });
      Alert.alert(isBoost ? 'Boost' : 'Campaign', message);
      router.back();
    } catch (error) {
      Alert.alert('Not saved', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!token || !campaign) return;
    Alert.alert('Delete this campaign?', 'Your package goes back to "Your packages" so you can use it again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await deleteCampaign(token, campaign.id);
            await queryClient.invalidateQueries({ queryKey: ['my-ads'] });
            router.back();
          } catch (error) {
            Alert.alert('Not deleted', error instanceof ApiError ? error.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  function toggleMedia(id: string) {
    setMediaIds((current) => current.includes(id)
      ? current.filter((m) => m !== id)
      : current.length >= maxCreatives ? current : [...current, id]);
  }

  if (adsQuery.isLoading || !loaded) {
    return <ThemedView style={styles.container}><ActivityIndicator style={styles.loading} /></ThemedView>;
  }
  if (!entitlement || !pkg) {
    return <ThemedView style={styles.container}><ThemedText style={styles.loading}>This package or campaign is not available.</ThemedText></ThemedView>;
  }

  const field = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: campaign ? 'Edit campaign' : isBoost ? 'Boost a listing' : 'New campaign' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.pkgBanner}>
            <Ionicons name={isBoost ? 'rocket' : 'megaphone'} size={18} color={Palette.lemonInk} />
            <ThemedText type="smallBold" style={styles.pkgBannerText}>
              {pkg.name} · {formatDuration(pkg.duration_hours)}{isBoost ? '' : ` · up to ${maxCreatives} creative${maxCreatives === 1 ? '' : 's'}`}
            </ThemedText>
          </View>
          {campaign?.review_note && ['rejected', 'suspended'].includes(campaign.status) ? (
            <View style={styles.reviewNote}><ThemedText type="small" style={{ color: Palette.red }}>One Dream: {campaign.review_note}</ThemedText></View>
          ) : null}
          {campaign?.status === 'active' && !isBoost ? (
            <ThemedText type="small" style={styles.warn}>This campaign is live. Changing it sends it back for review and pauses it until approved - the paid period keeps running.</ThemedText>
          ) : null}
          {!editable ? <ThemedText type="small" themeColor="textSecondary">This campaign can no longer be changed.</ThemedText> : null}

          {isBoost ? (
            <>
              <ThemedText type="smallBold">Listing to boost</ThemedText>
              {liveListings.length ? liveListings.map((item) => (
                <Pressable key={item.id} disabled={!editable} onPress={() => setListingId(item.id)} style={[styles.option, { borderColor: listingId === item.id ? Palette.blue : theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
                  {item.images?.[0] ? <Image source={{ uri: item.images[0] }} style={styles.optionImage} /> : <View style={[styles.optionImage, styles.placeholder]} />}
                  <ThemedText type="smallBold" style={styles.flex} numberOfLines={2}>{item.title}</ThemedText>
                  <Ionicons name={listingId === item.id ? 'radio-button-on' : 'radio-button-off'} size={20} color={Palette.blue} />
                </Pressable>
              )) : <ThemedText type="small" themeColor="textSecondary">You have no live listings to boost yet.</ThemedText>}
            </>
          ) : (
            <>
              <ThemedText type="smallBold">Headline</ThemedText>
              <TextInput editable={editable} value={title} onChangeText={setTitle} maxLength={80} placeholder="e.g. Fresh pastries delivered in Lagos" placeholderTextColor={theme.textSecondary} style={field} />
              <ThemedText type="smallBold">Description (optional)</ThemedText>
              <TextInput editable={editable} value={body} onChangeText={setBody} maxLength={280} multiline placeholder="One or two sentences" placeholderTextColor={theme.textSecondary} style={[field, styles.multiline]} />
              <ThemedText type="smallBold">Button text (optional)</ThemedText>
              <TextInput editable={editable} value={cta} onChangeText={setCta} maxLength={24} placeholder="Shop now" placeholderTextColor={theme.textSecondary} style={field} />

              <ThemedText type="smallBold">When people tap it</ThemedText>
              <View style={styles.choices}>
                {pkg.allow_external_link ? <Choice label="Your website" selected={destination === 'external'} onPress={() => editable && setDestination('external')} /> : null}
                <Choice label="A listing" selected={destination === 'listing'} onPress={() => editable && setDestination('listing')} />
                <Choice label="Your shop" selected={destination === 'profile'} onPress={() => editable && setDestination('profile')} />
              </View>
              {destination === 'external' ? (
                <>
                  <TextInput editable={editable} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="https://your-website.com/page" placeholderTextColor={theme.textSecondary} style={field} />
                  <ThemedText type="small" themeColor="textSecondary">HTTPS links only. We check the link and its redirects, and One Dream reviews it before your ad goes live.</ThemedText>
                </>
              ) : null}
              {destination === 'listing' ? liveListings.map((item) => (
                <Pressable key={item.id} disabled={!editable} onPress={() => setListingId(item.id)} style={[styles.option, { borderColor: listingId === item.id ? Palette.blue : theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small" style={styles.flex} numberOfLines={1}>{item.title}</ThemedText>
                  <Ionicons name={listingId === item.id ? 'radio-button-on' : 'radio-button-off'} size={18} color={Palette.blue} />
                </Pressable>
              )) : null}

              <ThemedText type="smallBold">Creatives ({mediaIds.length}/{maxCreatives})</ThemedText>
              {library.length ? (
                <View style={styles.grid}>
                  {library.map((m) => {
                    const selected = mediaIds.includes(m.id);
                    return (
                      <Pressable key={m.id} disabled={!editable} onPress={() => toggleMedia(m.id)} style={[styles.tile, { borderColor: selected ? Palette.blue : theme.backgroundSelected }]}>
                        {m.url ? <Image source={{ uri: m.poster || m.url }} style={styles.tileImage} /> : <View style={[styles.tileImage, styles.placeholder]} />}
                        {selected ? <View style={styles.tick}><Ionicons name="checkmark" size={14} color="#fff" /></View> : null}
                        <ThemedText type="small" style={styles.tileLabel}>{m.resource_type === 'video' ? 'Video' : 'Image'} · {m.status === 'approved' ? 'approved' : 'in review'}</ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Pressable onPress={() => router.push('/promote' as never)} style={styles.option}>
                  <ThemedText type="small">Upload images or videos in Promote → Media first.</ThemedText>
                </Pressable>
              )}
            </>
          )}

          {editable ? (
            <View style={styles.actions}>
              {campaign?.status !== 'active' ? (
                <Pressable onPress={() => void save(true)} disabled={busy} style={[styles.primary, busy && styles.disabled]}>
                  {busy ? <ActivityIndicator color={Palette.lemonInk} /> : <ThemedText type="smallBold" style={styles.primaryText}>{isBoost ? 'Start boost now' : 'Submit for review'}</ThemedText>}
                </Pressable>
              ) : null}
              <Pressable onPress={() => void save(false)} disabled={busy} style={[styles.secondary, busy && styles.disabled]}>
                <ThemedText type="smallBold" style={styles.secondaryText}>{campaign?.status === 'active' ? 'Save changes' : 'Save draft'}</ThemedText>
              </Pressable>
              {campaign && ['draft', 'rejected'].includes(campaign.status) ? (
                <Pressable onPress={remove} style={styles.danger}><ThemedText type="smallBold" style={{ color: Palette.red }}>Delete and return package</ThemedText></Pressable>
              ) : null}
            </View>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {isBoost
              ? 'Your listing is marked Sponsored and shown more often in eligible shop placements for the package period. Sales and views are not guaranteed.'
              : 'Ads are labelled Sponsored. Your package time starts when the ad is approved and goes live.'}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}>
      <ThemedText type="smallBold" style={{ color: selected ? Palette.white : Palette.blueDark }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  flex: { flex: 1 },
  scroll: { paddingVertical: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  pkgBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.three, backgroundColor: Palette.lemon },
  pkgBannerText: { color: Palette.lemonInk, flex: 1 },
  reviewNote: { borderRadius: 12, padding: Spacing.three, backgroundColor: Palette.redSoft },
  warn: { color: Palette.yellowInk, backgroundColor: Palette.yellowSoft, borderRadius: 12, padding: Spacing.three },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Palette.blueSoft },
  choiceSelected: { backgroundColor: Palette.blue },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, borderWidth: 1.5, borderColor: Palette.ash, padding: Spacing.two },
  optionImage: { width: 48, height: 48, borderRadius: 10 },
  placeholder: { backgroundColor: Palette.ashSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { width: '31%', borderRadius: 12, borderWidth: 2, overflow: 'hidden' },
  tileImage: { width: '100%', aspectRatio: 1 },
  tileLabel: { padding: 4, fontSize: 11 },
  tick: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: Palette.blue, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: Spacing.two, marginTop: Spacing.three },
  primary: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: Palette.lemon },
  primaryText: { color: Palette.lemonInk, fontSize: 15 },
  secondary: { borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Palette.blueSoft },
  secondaryText: { color: Palette.blueDark },
  danger: { alignItems: 'center', paddingVertical: 10 },
  disabled: { opacity: 0.6 },
});
