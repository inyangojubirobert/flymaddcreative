import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { EpubFrame } from '@/components/epub-frame';
import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { openEpub, previewHtml, sectionHtml, type EpubBook } from '@/lib/epub';

/** Full EPUB reader: one section at a time, with a watermark line. */
export function EpubReader({ load, watermark }: { load: () => Promise<Uint8Array>; watermark: string }) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [book, setBook] = useState<EpubBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    load()
      .then((bytes) => { if (alive) setBook(openEpub(bytes)); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not open this e-book.'); });
    return () => { alive = false; };
  }, [load]);

  const html = useMemo(() => {
    if (!book) return null;
    try {
      return sectionHtml(book, index, { watermark, dark });
    } catch {
      return null;
    }
  }, [book, index, watermark, dark]);

  if (error) return <ThemedText themeColor="textSecondary" style={styles.message}>{error}</ThemedText>;
  if (!book || !html) return <ActivityIndicator style={styles.message} />;
  const last = book.sections.length - 1;
  return (
    <View style={styles.flex}>
      <EpubFrame key={index} html={html} style={styles.flex} />
      <View style={[styles.bar, { borderColor: theme.backgroundSelected, backgroundColor: theme.background }]}>
        <Pressable disabled={index === 0} onPress={() => setIndex(index - 1)} hitSlop={10} style={index === 0 && styles.off}>
          <Ionicons name="chevron-back" size={24} color={Palette.blue} />
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">Section {index + 1} of {book.sections.length}</ThemedText>
        <Pressable disabled={index === last} onPress={() => setIndex(index + 1)} hitSlop={10} style={index === last && styles.off}>
          <Ionicons name="chevron-forward" size={24} color={Palette.blue} />
        </Pressable>
      </View>
    </View>
  );
}

/** Free preview sections (text only, from the server). */
export function EpubPreview({ sections }: { sections: string[] }) {
  const [index, setIndex] = useState(0);
  const dark = useColorScheme() === 'dark';
  return (
    <View style={styles.preview}>
      <EpubFrame key={index} html={previewHtml(sections[index], dark)} style={styles.flex} />
      {sections.length > 1 ? (
        <View style={styles.bar}>
          <Pressable disabled={index === 0} onPress={() => setIndex(index - 1)} hitSlop={10} style={index === 0 && styles.off}><Ionicons name="chevron-back" size={20} color={Palette.blue} /></Pressable>
          <ThemedText type="small" themeColor="textSecondary">Preview {index + 1} of {sections.length}</ThemedText>
          <Pressable disabled={index === sections.length - 1} onPress={() => setIndex(index + 1)} hitSlop={10} style={index === sections.length - 1 && styles.off}><Ionicons name="chevron-forward" size={20} color={Palette.blue} /></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  message: { marginTop: Spacing.six, textAlign: 'center', paddingHorizontal: Spacing.four },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  off: { opacity: 0.3 },
  preview: { height: 360, borderRadius: 12, overflow: 'hidden', backgroundColor: Palette.ashSoft },
});
