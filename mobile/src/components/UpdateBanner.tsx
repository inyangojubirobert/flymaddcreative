import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { ThemedText } from './themed-text';
import { useAppUpdateCheck } from '@/hooks/useAppUpdateCheck';

// Non-intrusive: renders nothing unless the backend reports a newer build,
// so it never changes any existing screen's UI when the app is up to date.
export function UpdateBanner() {
  const updateInfo = useAppUpdateCheck();
  if (!updateInfo) return null;

  return (
    <SafeAreaView edges={['top']} style={styles.wrap} pointerEvents="box-none">
      <Pressable onPress={() => WebBrowser.openBrowserAsync(updateInfo.downloadUrl)} style={styles.banner}>
        <ThemedText style={styles.text}>🆕 Update available (v{updateInfo.latestVersion}) — tap to download</ThemedText>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999 },
  banner: { backgroundColor: '#1D4ED8', paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center' },
  text: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
