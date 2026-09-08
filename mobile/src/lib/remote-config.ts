// Fetches GET /api/config.js at app boot rather than hardcoding the
// Supabase URL/anon key or Paystack public key - this stays in sync with
// whatever the server is actually configured with. Falls back to a
// last-known snapshot so the app isn't dead in the water if this one call
// fails before anything else initializes.

import { apiFetch } from './api-client';

export type RemoteConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
  paystack: { publicKey: string };
  crypto: {
    networks: string[];
    addresses: { bsc: string; tron: string };
  };
};

// Last-known-good values, only used if the live /api/config call fails.
const FALLBACK_CONFIG: RemoteConfig = {
  supabaseUrl: 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
  supabaseAnonKey: 'sb_publishable_Tt2LJZ8itium6JTt9PQyrQ_SZHiRW_m',
  siteUrl: 'https://www.flymaddcreative.online',
  paystack: { publicKey: 'pk_live_689666a376853473f2945d2032123db6cd53239d' },
  crypto: {
    networks: ['bsc', 'tron'],
    addresses: {
      bsc: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
      tron: 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL',
    },
  },
};

let cachedConfig: RemoteConfig | null = null;

export async function loadRemoteConfig(): Promise<RemoteConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const data = await apiFetch<RemoteConfig>('/api/config');
    cachedConfig = data;
    return data;
  } catch (error) {
    console.warn('[remote-config] falling back to last-known config:', error);
    cachedConfig = FALLBACK_CONFIG;
    return FALLBACK_CONFIG;
  }
}

export function getCachedConfig(): RemoteConfig | null {
  return cachedConfig;
}
