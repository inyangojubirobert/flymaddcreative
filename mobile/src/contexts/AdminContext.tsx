import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { ApiError, apiFetch } from '@/lib/api-client';
import { useAuth } from '@/contexts/AuthContext';

// Admin tab (same idea as Book of Memes): an admin uses the app with their
// normal account. If that account is linked to an admin
// (admin_users.participant_id), the server hands out an admin token and the
// Admin tab appears; for everyone else nothing changes.
// The token is also saved where Admin alerts / Brand promotion look for it.

const ADMIN_TOKEN_KEY = 'admin_alert_token';
const REFRESH_MS = 6 * 3600e3; // admin tokens last 8 h

type AdminInfo = { id: string; email: string; display_name: string };

type AdminContextValue = {
  isAdmin: boolean;
  admin: AdminInfo | null;
  adminToken: string | null;
  /** apiFetch with the admin token; gets a fresh token once if it expired. */
  adminFetch: <T = unknown>(path: string, options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) => Promise<T>;
  refresh: () => Promise<void>;
};

const AdminContext = createContext<AdminContextValue>({
  isAdmin: false,
  admin: null,
  adminToken: null,
  adminFetch: () => Promise.reject(new Error('Admins only')),
  refresh: async () => {},
});

async function storeToken(token: string | null) {
  if (Platform.OS === 'web') return;
  try {
    if (token) await SecureStore.setItemAsync(ADMIN_TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(ADMIN_TOKEN_KEY);
  } catch { /* the in-memory token still works */ }
}

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  // The participant session the admin token was issued for: after a sign-out
  // or a different sign-in, the old admin token is never used.
  const [adminFor, setAdminFor] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const forRef = useRef<string | null>(null);
  const fetchedAt = useRef(0);

  const refresh = useCallback(async () => {
    if (forRef.current !== token && tokenRef.current) {
      tokenRef.current = null;
      await storeToken(null);
    }
    if (!token) return; // signed out: isAdmin below is already false
    try {
      const r = await apiFetch<{ is_admin: boolean; token?: string; admin?: AdminInfo }>('/api/admin/app-session', { token });
      fetchedAt.current = Date.now();
      if (r.is_admin && r.token) {
        tokenRef.current = r.token; forRef.current = token;
        setAdminToken(r.token); setAdminFor(token); setAdmin(r.admin || null);
        await storeToken(r.token);
      } else {
        if (tokenRef.current) await storeToken(null);
        tokenRef.current = null; forRef.current = null;
        setAdminToken(null); setAdminFor(null); setAdmin(null);
      }
    } catch {
      // Offline or server error: keep whatever we had.
    }
  }, [token]);

  useEffect(() => {
    const t = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - fetchedAt.current > REFRESH_MS) void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const adminFetch = useCallback(async <T,>(path: string, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> => {
    if (!tokenRef.current) throw new ApiError('Admins only', 403, null);
    try {
      return await apiFetch<T>(path, { ...options, token: tokenRef.current });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      await refresh();
      if (!tokenRef.current) throw error;
      return apiFetch<T>(path, { ...options, token: tokenRef.current });
    }
  }, [refresh]);

  const current = !!token && !!adminToken && adminFor === token;
  return (
    <AdminContext.Provider value={{ isAdmin: current, admin: current ? admin : null, adminToken: current ? adminToken : null, adminFetch, refresh }}>
      {children}
    </AdminContext.Provider>
  );
}

export const useAdmin = () => useContext(AdminContext);
