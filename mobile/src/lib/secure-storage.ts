// Bearer token storage for the two independent auth sessions (participant,
// merchant). Uses expo-secure-store (Keychain on iOS, Keystore-backed
// EncryptedSharedPreferences on Android) rather than AsyncStorage, since
// these tokens authorize money-moving actions (release_funds, withdraw).

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// expo-secure-store has no web implementation. The hosted web app (/app) runs
// on the website's origin, so it uses localStorage - with the same
// 'onedream_token' key the website's login writes, so one sign-in covers both.
const store = Platform.OS === 'web'
  ? {
      getItemAsync: async (key: string) => globalThis.localStorage?.getItem(key) ?? null,
      setItemAsync: async (key: string, value: string) => { globalThis.localStorage?.setItem(key, value); },
      deleteItemAsync: async (key: string) => { globalThis.localStorage?.removeItem(key); },
    }
  : SecureStore;

const PARTICIPANT_TOKEN_KEY = 'onedream_token';
const PARTICIPANT_SNAPSHOT_KEY = 'onedream_participant_snapshot';
const WEBSITE_USER_KEY = 'onedream_user';
const MERCHANT_TOKEN_KEY = 'merchant_token';
const MERCHANT_SNAPSHOT_KEY = 'merchant_snapshot';

export const participantTokenStorage = {
  get: () => store.getItemAsync(PARTICIPANT_TOKEN_KEY),
  set: (token: string) => store.setItemAsync(PARTICIPANT_TOKEN_KEY, token),
  clear: () => store.deleteItemAsync(PARTICIPANT_TOKEN_KEY),
};

// GET /api/onedream/verify.js only confirms a token is valid ({userId, email}) -
// it doesn't return the full profile (username, total_votes, etc.), and
// there's no "get participant by id" endpoint. So a boot-time session
// restore needs a locally cached snapshot (to know the username at all,
// which every other participant-data endpoint is keyed on) that gets
// refreshed from the server right after. Nothing in this snapshot is
// sensitive (name/username/vote count are already public data).
export const participantSnapshotStorage = {
  get: async <T,>(): Promise<T | null> => {
    // On web, fall back to the profile the website's login stored ({ id, username, ... }).
    const raw = await store.getItemAsync(PARTICIPANT_SNAPSHOT_KEY)
      ?? (Platform.OS === 'web' ? await store.getItemAsync(WEBSITE_USER_KEY) : null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as T & { username?: string };
      return parsed?.username ? parsed : null;
    } catch {
      return null;
    }
  },
  set: (snapshot: unknown) => store.setItemAsync(PARTICIPANT_SNAPSHOT_KEY, JSON.stringify(snapshot)),
  clear: async () => {
    await store.deleteItemAsync(PARTICIPANT_SNAPSHOT_KEY);
    if (Platform.OS === 'web') await store.deleteItemAsync(WEBSITE_USER_KEY);
  },
};

export const merchantTokenStorage = {
  get: () => store.getItemAsync(MERCHANT_TOKEN_KEY),
  set: (token: string) => store.setItemAsync(MERCHANT_TOKEN_KEY, token),
  clear: () => store.deleteItemAsync(MERCHANT_TOKEN_KEY),
};

// There's no working merchant equivalent of /api/onedream/verify.js (the
// /me route on pages/api/merchants/[...slug].js always 401s - confirmed
// dead in the API audit). So a boot-time restore has nothing to verify
// against except retrying an actual authenticated call; this snapshot lets
// the UI optimistically show the merchant as logged in immediately, and
// MerchantAuthContext clears both on the first 401 from a real request.
export const merchantSnapshotStorage = {
  get: async <T,>(): Promise<T | null> => {
    const raw = await store.getItemAsync(MERCHANT_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  set: (snapshot: unknown) => store.setItemAsync(MERCHANT_SNAPSHOT_KEY, JSON.stringify(snapshot)),
  clear: () => store.deleteItemAsync(MERCHANT_SNAPSHOT_KEY),
};
