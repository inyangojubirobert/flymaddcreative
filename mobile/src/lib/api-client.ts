// Thin fetch wrapper for the Next.js backend (pages/api/** in the root
// project - see the mobile build plan for the full endpoint reference).
// Deliberately not a heavier HTTP client: this app's needs are plain
// JSON in/out plus an optional bearer token, which is all `fetch` needs.

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://www.flymaddcreative.online';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
};

export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, headers = {} } = options;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Every route in the backend responds with JSON (success or error shape),
  // even on failure - safe to always attempt to parse it.
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = (data as { error?: string; message?: string })?.error
      || (data as { error?: string; message?: string })?.message
      || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

export { API_BASE_URL };
