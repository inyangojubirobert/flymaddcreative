import { useEffect, useRef } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { getSponsored, trackAdEvent, type AdPlacement, type ServedAd } from '@/api/ads';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Sponsored content for a placement: up to `ads` banners and `boosts` boosted listings. */
export function useSponsored(placement: AdPlacement, options: { ads?: number; boosts?: number; categoryId?: string | null } = {}) {
  return useQuery({
    queryKey: ['sponsored', placement, options.ads ?? 0, options.boosts ?? 0, options.categoryId ?? null],
    queryFn: () => getSponsored(placement, options),
    staleTime: 60_000,
  });
}

/** One sponsored banner, clearly labelled. Renders nothing when no ad is live. */
export function SponsoredBanner({ placement, categoryId }: { placement: AdPlacement; categoryId?: string | null }) {
  const query = useSponsored(placement, { ads: 1, categoryId });
  const ad = query.data?.ads?.[0];
  if (!ad) return null;
  return <SponsoredAdCard ad={ad} placement={placement} />;
}

export function SponsoredAdCard({ ad, placement }: { ad: ServedAd; placement: AdPlacement }) {
  const theme = useTheme();
  const router = useRouter();
  const seen = useRef<string | null>(null);
  const media = ad.media[0];

  useEffect(() => {
    if (seen.current === ad.id) return;
    seen.current = ad.id;
    trackAdEvent(ad.id, 'impression', placement);
  }, [ad.id, placement]);

  function open() {
    trackAdEvent(ad.id, 'click', placement);
    const { destination } = ad;
    if (destination.type === 'listing' && destination.listing_id) {
      router.push(`/catalogue/item/${destination.listing_id}` as never);
    } else if (destination.type === 'profile' && destination.username) {
      router.push(`/catalogue/${destination.username}` as never);
    } else if (destination.type === 'external' && destination.url) {
      const url = destination.url;
      let host = url;
      try { host = new URL(url).hostname; } catch { /* keep full url */ }
      Alert.alert('Leaving One Dream', `This sponsored link opens ${host} in your browser.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open', onPress: () => void Linking.openURL(url) },
      ]);
    }
  }

  function playVideo() {
    if (media?.type === 'video') {
      trackAdEvent(ad.id, 'click', placement);
      void WebBrowser.openBrowserAsync(media.url);
    } else {
      open();
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]} accessibilityLabel={`Sponsored: ${ad.title}`}>
      {media ? (
        <Pressable onPress={playVideo} style={styles.mediaWrap}>
          <Image source={{ uri: media.type === 'video' ? media.poster || media.url : media.url }} style={styles.media} resizeMode="cover" />
          {media.type === 'video' ? (
            <View style={styles.play}><Ionicons name="play" size={22} color="#fff" /></View>
          ) : null}
          <View style={styles.badge}><ThemedText style={styles.badgeText}>Sponsored</ThemedText></View>
        </Pressable>
      ) : null}
      <View style={styles.copy}>
        <ThemedText type="smallBold" numberOfLines={2}>{ad.title}</ThemedText>
        {ad.body ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{ad.body}</ThemedText> : null}
        <Pressable onPress={open} style={styles.cta} accessibilityRole="link">
          <ThemedText type="smallBold" style={styles.ctaText}>{ad.cta_label}</ThemedText>
          <Ionicons name={ad.destination.type === 'external' ? 'open-outline' : 'chevron-forward'} size={14} color={Palette.blueDark} />
        </Pressable>
      </View>
    </View>
  );
}

export function SponsoredTag() {
  return (
    <View style={styles.tag}>
      <ThemedText style={styles.tagText}>Sponsored</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  mediaWrap: { aspectRatio: 16 / 9, backgroundColor: Palette.ashSoft },
  media: { width: '100%', height: '100%' },
  play: { position: 'absolute', alignSelf: 'center', top: '38%', width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(15,23,42,0.7)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', left: 10, top: 10, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: 'rgba(15,23,42,0.72)' },
  badgeText: { color: '#fff', fontSize: 11, lineHeight: 14, fontWeight: '700' },
  copy: { padding: Spacing.three, gap: 4 },
  cta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: Palette.blueSoft },
  ctaText: { color: Palette.blueDark },
  tag: { position: 'absolute', left: 8, top: 8, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(15,23,42,0.72)' },
  tagText: { color: '#fff', fontSize: 10, lineHeight: 13, fontWeight: '700' },
});
