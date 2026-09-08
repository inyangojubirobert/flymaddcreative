// Bearer token storage for the two independent auth sessions (participant,
// merchant). Uses expo-secure-store (Keychain on iOS, Keystore-backed
// EncryptedSharedPreferences on Android) rather than AsyncStorage, since
// these tokens authorize money-moving actions (release_funds, withdraw).

import * as SecureStore from 'expo-secure-store';

const PARTICIPANT_TOKEN_KEY = 'onedream_token';
const PARTICIPANT_SNAPSHOT_KEY = 'onedream_participant_snapshot';
const MERCHANT_TOKEN_KEY = 'merchant_token';
const MERCHANT_SNAPSHOT_KEY = 'merchant_snapshot';

export const participantTokenStorage = {
  get: () => SecureStore.getItemAsync(PARTICIPANT_TOKEN_KEY),
  set: (token: string) => SecureStore.setItemAsync(PARTICIPANT_TOKEN_KEY, token),
  clear: () => SecureStore.deleteItemAsync(PARTICIPANT_TOKEN_KEY),
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
    const raw = await SecureStore.getItemAsync(PARTICIPANT_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  set: (snapshot: unknown) => SecureStore.setItemAsync(PARTICIPANT_SNAPSHOT_KEY, JSON.stringify(snapshot)),
  clear: () => SecureStore.deleteItemAsync(PARTICIPANT_SNAPSHOT_KEY),
};

export const merchantTokenStorage = {
  get: () => SecureStore.getItemAsync(MERCHANT_TOKEN_KEY),
  set: (token: string) => SecureStore.setItemAsync(MERCHANT_TOKEN_KEY, token),
  clear: () => SecureStore.deleteItemAsync(MERCHANT_TOKEN_KEY),
};

// There's no working merchant equivalent of /api/onedream/verify.js (the
// /me route on pages/api/merchants/[...slug].js always 401s - confirmed
// dead in the API audit). So a boot-time restore has nothing to verify
// against except retrying an actual authenticated call; this snapshot lets
// the UI optimistically show the merchant as logged in immediately, and
// MerchantAuthContext clears both on the first 401 from a real request.
export const merchantSnapshotStorage = {
  get: async <T,>(): Promise<T | null> => {
    const raw = await SecureStore.getItemAsync(MERCHANT_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  set: (snapshot: unknown) => SecureStore.setItemAsync(MERCHANT_SNAPSHOT_KEY, JSON.stringify(snapshot)),
  clear: () => SecureStore.deleteItemAsync(MERCHANT_SNAPSHOT_KEY),
};
