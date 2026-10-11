import { apiFetch, API_BASE_URL, ApiError } from '../lib/api-client';
import type { CatalogueItem } from './catalogue';
import type { Participant } from './auth';

export type MarketplaceSearchCategory = {
  category_id: string;
  category_name: string;
  category_slug: string;
  is_department: boolean;
  department_id: string;
  department_name: string;
  match_type: string;
  rank: number;
};

export type MarketplaceSearchItem = CatalogueItem;
export type MarketplaceSearchOptions = { categoryId?: string; departmentId?: string; listingType?: string };
export type MarketplaceSearchResult = {
  participants: Participant[];
  categories: MarketplaceSearchCategory[];
  items: MarketplaceSearchItem[];
  categorySearch?: 'rpc' | 'fallback' | 'unavailable';
  unavailable?: string[];
};

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

/** Shared by native and Expo web; cancellation prevents stale requests winning. */
export async function searchMarketplace(query: string, options: MarketplaceSearchOptions = {}, signal?: AbortSignal): Promise<MarketplaceSearchResult> {
  const term = query.trim().slice(0, 200);
  if (!term) return { participants: [], categories: [], items: [], categorySearch: 'rpc', unavailable: [] };
  const params = new URLSearchParams({ q: term });
  if (options.categoryId) params.set('category_id', options.categoryId);
  if (options.departmentId) params.set('department_id', options.departmentId);
  if (options.listingType) params.set('listing_type', options.listingType);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(API_BASE_URL + '/api/onedream/search?' + params, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new ApiError('Search is temporarily unavailable', response.status);
    return {
      participants: data.participants ?? [], categories: data.categories ?? [], items: data.items ?? [],
      categorySearch: data.categorySearch, unavailable: data.unavailable ?? [],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getLeaderboard(limit = 50): Promise<Participant[]> {
  const data = await apiFetch<{ participants: Participant[] }>(
    `/api/onedream/leaderboard?limit=${limit}`
  );
  return data.participants;
}
