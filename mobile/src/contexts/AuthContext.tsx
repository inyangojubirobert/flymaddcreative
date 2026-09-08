import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, verifyToken, type Participant } from '../api/auth';
import { getParticipantByUsername } from '../api/participants';
import { participantTokenStorage, participantSnapshotStorage } from '../lib/secure-storage';

type AuthContextValue = {
  participant: Participant | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; username: string; password: string; ref_code?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshParticipant: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Boot-time session restore: read the stored token + last-known snapshot,
  // confirm the token is still valid, then refresh from the server.
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, snapshot] = await Promise.all([
          participantTokenStorage.get(),
          participantSnapshotStorage.get<Participant>(),
        ]);

        if (!storedToken || !snapshot) {
          setIsLoading(false);
          return;
        }

        const result = await verifyToken(storedToken);
        if (!result.valid) {
          await participantTokenStorage.clear();
          await participantSnapshotStorage.clear();
          setIsLoading(false);
          return;
        }

        setToken(storedToken);
        setParticipant(snapshot); // show cached data immediately
        try {
          const fresh = await getParticipantByUsername(snapshot.username);
          setParticipant(fresh);
          await participantSnapshotStorage.set(fresh);
        } catch {
          // Keep the cached snapshot if the refresh fails (e.g. offline) - token is already confirmed valid.
        }
      } catch (error) {
        console.warn('[AuthContext] session restore failed:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persistSession = useCallback(async (result: { participant: Participant; token: string }) => {
    await participantTokenStorage.set(result.token);
    await participantSnapshotStorage.set(result.participant);
    setToken(result.token);
    setParticipant(result.participant);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin({ email, password });
    await persistSession(result);
  }, [persistSession]);

  const register = useCallback(async (input: { name: string; email: string; username: string; password: string; ref_code?: string }) => {
    const result = await apiRegister(input);
    await persistSession(result);
  }, [persistSession]);

  const logout = useCallback(async () => {
    await participantTokenStorage.clear();
    await participantSnapshotStorage.clear();
    setToken(null);
    setParticipant(null);
  }, []);

  const refreshParticipant = useCallback(async () => {
    if (!participant) return;
    const fresh = await getParticipantByUsername(participant.username);
    setParticipant(fresh);
    await participantSnapshotStorage.set(fresh);
  }, [participant]);

  return (
    <AuthContext.Provider value={{ participant, token, isLoading, login, register, logout, refreshParticipant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
