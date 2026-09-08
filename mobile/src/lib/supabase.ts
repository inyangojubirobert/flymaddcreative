// Supabase client for direct anon-key reads only (catalogue browsing).
// This app has no Supabase Auth usage anywhere - all auth is the backend's
// custom JWT (bcrypt + jsonwebtoken) against participants/referral_merchants
// - so supabase.auth.* is never called and there's no session to persist.
// That's why auth.persistSession is off and no AsyncStorage adapter is wired
// up: there's nothing for it to store.

import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadRemoteConfig } from './remote-config';

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = loadRemoteConfig().then(({ supabaseUrl, supabaseAnonKey }) =>
      createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    );
  }
  return clientPromise;
}
