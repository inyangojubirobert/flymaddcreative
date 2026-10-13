import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { File, Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';

import { EpubReader } from '@/components/epub-reader';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getLibrary, openLibraryEntry, parseLibraryEntryId, type LicenseAccess } from '@/api/digital';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useContentWidth } from '@/hooks/use-content-width';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';
import {
  bytesUsed, clearPlaybackCache, digitalDeviceId, downloadForOffline, extendOffline, offlineFileBytes, offlineMediaUri,
  offlinePageUri, offlineSupported, readManifest, removeOffline, type OfflineFile, type OfflineManifest,
} from '@/lib/digital-offline';

// Reader / player for one licensed product, or one item of a creator
// subscription ("s_<itemId>"). Uses the encrypted offline copy when there is
// one (no internet needed), re-validates access when online (wiping the copy
// if it was refunded / the subscription ended), and blocks screenshots.

type Track = {
  id: string;
  kind: string;
  title: string | null;
  duration_seconds: number | null;
  pages?: string[];          // online: page image URLs; offline: encrypted page files
  uri?: string;              // online media / EPUB URL
  watermark?: string;
  offline?: OfflineFile;
};

export default function LibraryEntryScreen() {
  usePreventScreenCapture();
  const { licenseId: entryId } = useLocalSearchParams<{ licenseId: string }>();
  const { itemId: subItemId } = parseLibraryEntryId(entryId);
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [manifest, setManifest] = useState<OfflineManifest | null | undefined>(undefined);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState(0);

  const libraryQuery = useQuery({ queryKey: ['library'], queryFn: () => getLibrary(token!), enabled: !!token });
  const item = subItemId
    ? libraryQuery.data?.subscription_items?.find((i) => i.item_id === subItemId)
    : libraryQuery.data?.items.find((i) => i.license_id === entryId);

  useEffect(() => { void readManifest(entryId).then(setManifest); }, [entryId]);
  useEffect(() => () => clearPlaybackCache(), []);

  // Online check (also gives streaming access when not downloaded).
  const accessQuery = useQuery({
    queryKey: ['license-access', entryId],
    queryFn: async () => openLibraryEntry(token!, entryId, await digitalDeviceId()),
    enabled: !!token && !!entryId,
    retry: false,
    staleTime: 30 * 60_000,
  });
  const revoked = accessQuery.error instanceof ApiError && [403, 404].includes(accessQuery.error.status);
  useEffect(() => {
    if (revoked) void removeOffline(entryId).then(() => setManifest(null));
    else if (accessQuery.data && manifest) void extendOffline(entryId, accessQuery.data.offline_until);
  }, [revoked, accessQuery.data, manifest, entryId]);

  const tracks: Track[] = useMemo(() => {
    if (manifest) {
      return manifest.files.map((f) => ({ id: f.id, kind: f.kind, title: f.title, duration_seconds: f.duration_seconds, pages: f.pages, watermark: f.watermark, offline: f }));
    }
    return (accessQuery.data?.files ?? []).map((f) => ({
      id: f.id, title: f.title, kind: f.kind, duration_seconds: f.duration_seconds,
      ...(f.access.type === 'pages' ? { pages: f.access.pages } : { uri: f.access.url }),
      ...(f.access.type === 'epub' ? { watermark: f.access.watermark } : {}),
    }));
  }, [manifest, accessQuery.data]);

  async function download(access: LicenseAccess) {
    setProgress({ done: 0, total: 1 });
    try {
      const saved = await downloadForOffline(access, { entry_id: entryId, item_id: access.item_id, title: item?.title || 'Item', kind: item?.kind || '' },
        (done, total) => setProgress({ done, total }));
      setManifest(saved);
    } catch (error) {
      Alert.alert('Download failed', error instanceof Error ? error.message : 'Please try again on a stable connection.');
    } finally {
      setProgress(null);
    }
  }

  function removeDownload() {
    Alert.alert('Remove download?', 'You can download it again any time while online.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { void removeOffline(entryId).then(() => setManifest(null)); void queryClient.invalidateQueries({ queryKey: ['library'] }); } },
    ]);
  }

  const title = item?.title || manifest?.title || 'Library';
  const kind = item?.kind || manifest?.kind;
  const loading = manifest === undefined || (!manifest && accessQuery.isLoading);
  const first = tracks[0];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {revoked ? (
          <Message icon="close-circle" text={subItemId ? 'Your subscription no longer includes this item.' : 'Access to this item has ended (refunded or removed).'} />
        ) : loading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !tracks.length ? (
          <Message icon="cloud-offline" text={accessQuery.error instanceof ApiError ? accessQuery.error.message : 'Connect to the internet to open this item, then download it for offline use.'} />
        ) : (
          <>
            <View style={styles.toolbar}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                {manifest ? `Offline · encrypted · ${(bytesUsed(entryId) / 1048576).toFixed(1)} MB · until ${new Date(manifest.offline_until).toLocaleDateString()}` : 'Streaming'}
              </ThemedText>
              {offlineSupported && !manifest && accessQuery.data ? (
                <Pressable onPress={() => void download(accessQuery.data!)} disabled={!!progress} style={styles.toolButton}>
                  {progress ? <ThemedText type="smallBold" style={styles.toolText}>{progress.done}/{progress.total}</ThemedText> : (
                    <><Ionicons name="cloud-download" size={16} color={Palette.blueDark} /><ThemedText type="smallBold" style={styles.toolText}>Download</ThemedText></>
                  )}
                </Pressable>
              ) : null}
              {manifest ? (
                <Pressable onPress={removeDownload} style={styles.toolButton}>
                  <Ionicons name="trash-outline" size={16} color={Palette.red} />
                </Pressable>
              ) : null}
            </View>
            {first?.kind === 'epub' ? (
              <EpubFile entryId={entryId} track={first} />
            ) : kind === 'ebook' ? (
              <PageReader entryId={entryId} pages={first?.pages || []} offline={!!manifest} />
            ) : (
              <MediaPlayer entryId={entryId} kind={kind === 'video' ? 'video' : 'audio'} tracks={tracks} selected={selected} onSelect={setSelected} />
            )}
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function Message({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.message}>
      <Ionicons name={icon} size={40} color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary" style={styles.center}>{text}</ThemedText>
    </View>
  );
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not open this e-book. Please try again.');
    return new Uint8Array(await response.arrayBuffer());
  }
  // Native: through a temporary file, deleted straight after reading.
  const temp = await File.downloadFileAsync(url, new File(Paths.cache, `epub-${Date.now()}.tmp`), { idempotent: true });
  try {
    return await temp.bytes();
  } finally {
    if (temp.exists) temp.delete();
  }
}

function EpubFile({ entryId, track }: { entryId: string; track: Track }) {
  const file = track.offline?.file;
  const url = track.uri;
  const load = useCallback(
    () => (file ? offlineFileBytes(entryId, file) : url ? downloadBytes(url) : Promise.reject(new Error('Connect to the internet to open this e-book.'))),
    [entryId, file, url],
  );
  return <EpubReader load={load} watermark={track.watermark || 'One Dream'} />;
}

function EncryptedPage({ entryId, name, width }: { entryId: string; name: string; width: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    offlinePageUri(entryId, name).then((u) => { if (alive) setUri(u); }).catch(() => { if (alive) setUri(''); });
    return () => { alive = false; };
  }, [entryId, name]);
  const style = { width, height: width * 1.35, backgroundColor: '#fff' };
  if (uri === null) return <View style={[style, styles.pageLoading]}><ActivityIndicator /></View>;
  return uri ? <Image source={{ uri }} style={style} resizeMode="contain" /> : <View style={style} />;
}

function PageReader({ entryId, pages, offline }: { entryId: string; pages: string[]; offline: boolean }) {
  const width = Math.min(useContentWidth(), 820);
  const [page, setPage] = useState(1);
  return (
    <View style={styles.flex}>
      <FlatList
        data={pages}
        keyExtractor={(uri, i) => `${i}-${uri.slice(-24)}`}
        renderItem={({ item }) => (offline
          ? <EncryptedPage entryId={entryId} name={item} width={width} />
          : <Image source={{ uri: item }} style={{ width, height: width * 1.35, backgroundColor: '#fff' }} resizeMode="contain" />)}
        onViewableItemsChanged={({ viewableItems }) => { if (viewableItems[0]?.index !== undefined && viewableItems[0].index !== null) setPage(viewableItems[0].index + 1); }}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        initialNumToRender={2}
        windowSize={5}
      />
      <View style={styles.pageBadge}><ThemedText style={styles.pageBadgeText}>{page} / {pages.length}</ThemedText></View>
    </View>
  );
}

function MediaPlayer({ entryId, kind, tracks, selected, onSelect }: { entryId: string; kind: 'audio' | 'video'; tracks: Track[]; selected: number; onSelect: (i: number) => void }) {
  const theme = useTheme();
  const current = tracks[selected];
  return (
    <ScrollView contentContainerStyle={styles.playerScroll}>
      {current ? <TrackPlayer key={current.id} entryId={entryId} kind={kind} track={current} fallbackTitle={`Track ${selected + 1}`} /> : null}
      {tracks.map((t, i) => (
        <Pressable key={t.id} onPress={() => onSelect(i)} style={[styles.trackRow, { backgroundColor: i === selected ? Palette.blueSoft : theme.backgroundElement }]}>
          <Ionicons name={i === selected ? 'play-circle' : kind === 'video' ? 'film-outline' : 'musical-note'} size={20} color={Palette.blue} />
          <ThemedText type="smallBold" style={styles.flex} numberOfLines={1}>{t.title || `${kind === 'video' ? 'Lesson' : 'Track'} ${i + 1}`}</ThemedText>
          {t.duration_seconds ? <ThemedText type="small" themeColor="textSecondary">{Math.floor(t.duration_seconds / 60)}:{String(Math.round(t.duration_seconds % 60)).padStart(2, '0')}</ThemedText> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** One track: streams online, or decrypts the offline copy into a temporary file while playing. */
function TrackPlayer({ entryId, kind, track, fallbackTitle }: { entryId: string; kind: 'audio' | 'video'; track: Track; fallbackTitle: string }) {
  const [uri, setUri] = useState<string | null>(track.offline ? null : track.uri || null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!track.offline) return;
    let alive = true;
    clearPlaybackCache();
    offlineMediaUri(entryId, track.offline)
      .then((u) => { if (alive) setUri(u); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not open this track.'); });
    return () => { alive = false; };
  }, [entryId, track.offline]);
  if (error) return <ThemedText style={{ color: Palette.red }}>{error}</ThemedText>;
  if (!uri) return <ActivityIndicator style={styles.loading} />;
  return kind === 'video' ? <VideoTrack uri={uri} /> : <AudioTrack uri={uri} title={track.title || fallbackTitle} />;
}

function AudioTrack({ uri, title }: { uri: string; title: string }) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <View style={styles.audioCard}>
      <Ionicons name="musical-notes" size={36} color={Palette.lemonInk} />
      <ThemedText type="smallBold" numberOfLines={2} style={styles.center}>{title}</ThemedText>
      <ThemedText type="small" style={{ color: Palette.lemonInk }}>{fmt(status.currentTime || 0)} / {fmt(status.duration || 0)}</ThemedText>
      <View style={styles.audioControls}>
        <Pressable onPress={() => player.seekTo(Math.max(0, (status.currentTime || 0) - 15))} hitSlop={10}><Ionicons name="play-back" size={28} color={Palette.lemonInk} /></Pressable>
        <Pressable onPress={() => (status.playing ? player.pause() : player.play())} hitSlop={10}>
          <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={56} color={Palette.lemonInk} />
        </Pressable>
        <Pressable onPress={() => player.seekTo((status.currentTime || 0) + 15)} hitSlop={10}><Ionicons name="play-forward" size={28} color={Palette.lemonInk} /></Pressable>
      </View>
    </View>
  );
}

function VideoTrack({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" allowsPictureInPicture={false} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  loading: { marginTop: Spacing.six },
  message: { alignItems: 'center', gap: Spacing.two, marginTop: Spacing.six, paddingHorizontal: Spacing.four },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  toolButton: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Palette.blueSoft },
  toolText: { color: Palette.blueDark },
  pageLoading: { alignItems: 'center', justifyContent: 'center' },
  pageBadge: { position: 'absolute', bottom: 16, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(15,23,42,0.75)' },
  pageBadgeText: { color: '#fff', fontSize: 12 },
  playerScroll: { padding: Spacing.three, gap: Spacing.two },
  audioCard: { alignItems: 'center', gap: Spacing.two, borderRadius: 20, padding: Spacing.four, backgroundColor: Palette.lemon },
  audioControls: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000' },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, padding: Spacing.three },
});
