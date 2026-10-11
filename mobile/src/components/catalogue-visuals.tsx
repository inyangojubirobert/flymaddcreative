import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';

type Look = { icon: string; tint: string; ink: string };

function cleanUrl(value?: string | null) {
  return value?.trim() || '';
}

/** Square image from image_url, or the tinted icon when no image is stored or it fails to load. */
export function CatalogueThumb({
  imageUrl,
  icon,
  tint,
  ink,
  size,
  radius,
  iconSize,
  style,
}: Look & { imageUrl?: string | null; size: number; radius: number; iconSize: number; style?: StyleProp<ViewStyle> }) {
  const url = cleanUrl(imageUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: tint }, styles.thumb, style]}>
      {url && !failed ? (
        <ExpoImage source={{ uri: url }} style={styles.fill} contentFit="cover" cachePolicy="memory-disk" onError={() => setFailed(true)} />
      ) : (
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={iconSize} color={ink} />
      )}
    </View>
  );
}

/** Header banner for a department or category screen. Uses image_url / banner_title / banner_subtitle when set. */
export function CatalogueBanner({
  imageUrl,
  title,
  subtitle,
  icon,
  tint,
  ink,
  children,
}: Look & { imageUrl?: string | null; title: string; subtitle?: string | null; children?: React.ReactNode }) {
  const url = cleanUrl(imageUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    return (
      <View style={[styles.fallback, { backgroundColor: tint }]}>
        <View style={[styles.fallbackIcon, { backgroundColor: '#fff' }]}>
          <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={24} color={ink} />
        </View>
        <View style={styles.copy}>
          <ThemedText type="subtitle" style={{ color: ink }}>{title}</ThemedText>
          {subtitle ? <ThemedText type="small" style={{ color: ink }}>{subtitle}</ThemedText> : null}
          {children}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <ExpoImage source={{ uri: url }} style={styles.fill} contentFit="cover" cachePolicy="memory-disk" onError={() => setFailed(true)} />
      <View style={styles.overlay}>
        <ThemedText type="subtitle" style={styles.overlayTitle}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" style={styles.overlaySubtitle}>{subtitle}</ThemedText> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  frame: { height: 168, borderRadius: 18, overflow: 'hidden', backgroundColor: Palette.ashSoft },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.three, gap: 4, backgroundColor: 'rgba(15,23,42,0.45)' },
  overlayTitle: { color: '#fff' },
  overlaySubtitle: { color: '#F8FAFC' },
  fallback: { minHeight: 92, borderRadius: 18, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  fallbackIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 4 },
});
