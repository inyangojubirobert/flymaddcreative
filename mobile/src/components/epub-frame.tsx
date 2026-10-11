import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

// Shows one sanitised EPUB section. JavaScript, storage, file access and
// navigation are all off: the page is inert text and inline images.
export function EpubFrame({ html, style }: { html: string; style?: StyleProp<ViewStyle> }) {
  return (
    <WebView
      source={{ html }}
      originWhitelist={['*']}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      mixedContentMode="never"
      onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url.startsWith('data:')}
      style={style}
    />
  );
}
