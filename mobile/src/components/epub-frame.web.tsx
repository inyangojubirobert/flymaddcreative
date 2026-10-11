import { createElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

// Web: one sanitised EPUB section in a fully sandboxed iframe (no scripts,
// no same-origin access, no navigation, no forms or popups).
export function EpubFrame({ html, style }: { html: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      {createElement('iframe', { srcDoc: html, sandbox: '', title: 'Reader', referrerPolicy: 'no-referrer', style: { border: 0, width: '100%', height: '100%' } })}
    </View>
  );
}
