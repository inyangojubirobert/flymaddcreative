import { apiFetch } from '../lib/api-client';
import type { Participant } from './auth';

export async function getParticipantByUsername(username: string): Promise<Participant> {
  const data = await apiFetch<{ participant: Participant }>(
    `/api/onedream/participants/${encodeURIComponent(username)}`
  );
  return data.participant;
}

export async function searchParticipants(query: string): Promise<Participant[]> {
  if (!query.trim()) return [];
  const data = await apiFetch<{ participants: Participant[] }>(
    `/api/onedream/search?q=${encodeURIComponent(query)}`
  );
  return data.participants;
}

export async function getLeaderboard(limit = 50): Promise<Participant[]> {
  const data = await apiFetch<{ participants: Participant[] }>(
    `/api/onedream/leaderboard?limit=${limit}`
  );
  return data.participants;
}
