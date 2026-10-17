import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { postIntent } from '../api/earnings';

// Keeps the affiliate attribution tokens this device holds, per listing, and
// sends them with a payment reference BEFORE the buyer pays (the server then
// matches them to the verified order on its own). Purely additive: it never
// blocks, delays or changes checkout - every call swallows its errors.

const KEY = 'onedream_affiliate_tokens_v1';
const MAX_AGE_MS = 30 * 86400e3; // the server enforces the real window (7 days by default)
type Stored = Record<string, { t: string; at: number }>;

async function read(): Promise<Stored> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function write(value: Stored) {
  const raw = JSON.stringify(value);
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, raw);
    else await SecureStore.setItemAsync(KEY, raw);
  } catch {
    // Losing a token only loses a commission, never a purchase.
  }
}

/** Remembers the token for a listing (latest click wins). */
export async function rememberAffiliateToken(itemId: string, token: string) {
  if (!itemId || !token || token.length > 400) return;
  const now = Date.now();
  const stored = await read();
  for (const [id, entry] of Object.entries(stored)) if (now - entry.at > MAX_AGE_MS) delete stored[id];
  stored[itemId] = { t: token, at: now };
  // Keep the store small (SecureStore is meant for ~2 KB values).
  const newest = Object.entries(stored).sort((a, b) => b[1].at - a[1].at).slice(0, 8);
  await write(Object.fromEntries(newest));
}

export async function affiliateTokensFor(itemIds: string[]) {
  const stored = await read();
  return itemIds.map((id) => stored[id]?.t).filter((t): t is string => !!t);
}

/** Fire-and-forget: tells the server which partner links led to this payment. */
export function recordAffiliateIntent(input: { paymentRef: string; method: 'paystack' | 'usdt'; itemIds: string[]; buyerEmail?: string }) {
  void (async () => {
    try {
      const tokens = await affiliateTokensFor(input.itemIds);
      if (!tokens.length || !input.paymentRef) return;
      await postIntent({ payment_ref: input.paymentRef, method: input.method, buyer_email: input.buyerEmail, tokens });
    } catch {
      // Never surfaces to the buyer.
    }
  })();
}
