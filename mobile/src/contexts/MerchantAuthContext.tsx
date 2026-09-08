import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { registerMerchant, loginMerchant, type Merchant } from '../api/merchants';
import { merchantTokenStorage, merchantSnapshotStorage } from '../lib/secure-storage';

type MerchantAuthContextValue = {
  merchant: Merchant | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { merchant_name: string; email: string; company_name?: string; wallet_address?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Called when a real API call 401s - the stored token is dead, force logout. */
  handleUnauthorized: () => Promise<void>;
};

const MerchantAuthContext = createContext<MerchantAuthContextValue | undefined>(undefined);

export function MerchantAuthProvider({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // No working merchant /me endpoint exists (confirmed dead in the API
  // audit), so boot restore is optimistic: if a token + snapshot are
  // present, trust them immediately. The dashboard screen's own request
  // will surface a 401 if the token is actually stale, which calls
  // handleUnauthorized() below.
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, snapshot] = await Promise.all([
          merchantTokenStorage.get(),
          merchantSnapshotStorage.get<Merchant>(),
        ]);
        if (storedToken && snapshot) {
          setToken(storedToken);
          setMerchant(snapshot);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persistSession = useCallback(async (result: { merchant: Merchant; token: string }) => {
    await merchantTokenStorage.set(result.token);
    await merchantSnapshotStorage.set(result.merchant);
    setToken(result.token);
    setMerchant(result.merchant);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginMerchant({ email, password });
    await persistSession(result);
  }, [persistSession]);

  const register = useCallback(async (input: { merchant_name: string; email: string; company_name?: string; wallet_address?: string; password: string }) => {
    const result = await registerMerchant(input);
    await persistSession(result);
  }, [persistSession]);

  const logout = useCallback(async () => {
    await merchantTokenStorage.clear();
    await merchantSnapshotStorage.clear();
    setToken(null);
    setMerchant(null);
  }, []);

  return (
    <MerchantAuthContext.Provider value={{ merchant, token, isLoading, login, register, logout, handleUnauthorized: logout }}>
      {children}
    </MerchantAuthContext.Provider>
  );
}

export function useMerchantAuth(): MerchantAuthContextValue {
  const ctx = useContext(MerchantAuthContext);
  if (!ctx) throw new Error('useMerchantAuth must be used within a MerchantAuthProvider');
  return ctx;
}
