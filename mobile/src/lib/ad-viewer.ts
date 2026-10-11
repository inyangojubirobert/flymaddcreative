import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Random per-install id used only to de-duplicate ad impressions and clicks.
// It is hashed again on the server and is not linked to the account.

const KEY = 'onedream_ad_viewer_v1';
let cached: string | null = null;

function randomId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getAdViewerId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (stored && stored.length >= 16) return (cached = stored);
    const fresh = randomId();
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, fresh);
    else await SecureStore.setItemAsync(KEY, fresh);
    return (cached = fresh);
  } catch {
    return (cached = randomId());
  }
}
