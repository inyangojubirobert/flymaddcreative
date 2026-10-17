import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../lib/api-client';

// Multi-currency listings - pages/api/marketplace/**. The seller's listing
// currency and price are authoritative; equivalents shown to buyers are
// approximate, and what a buyer pays comes from a checkout quote.

export type MarketCurrency = {
  code: string; name: string; symbol: string; minor_units: number;
  checkout_route: 'paystack' | 'usdt'; settlement_currency: 'NGN' | 'USD'; explanation: string;
};
export type CurrenciesResponse = {
  listing_currencies_enabled: boolean;
  currencies: MarketCurrency[];
  rates: Record<string, { rate: string; published_at: string; source: string }>;
};

export const getCurrencies = () => apiFetch<CurrenciesResponse>('/api/marketplace/currencies');

/** Cached for 10 minutes; equivalents are display only. */
export function useCurrencies() {
  return useQuery({ queryKey: ['marketplace-currencies'], queryFn: getCurrencies, staleTime: 10 * 60 * 1000 });
}

export const setListingPrice = (token: string, input: { item_id: string; currency: string; amount: string }) =>
  apiFetch<{ item: { id: string; listing_currency: string; listing_price_minor: number; listing_price: string }; settlement_currency: string; checkout_route: string }>(
    '/api/marketplace/listing-price', { method: 'PATCH', token, body: input });

export type Quote = {
  id: string; checkout_currency: 'NGN' | 'USD'; checkout_route: 'paystack' | 'usdt';
  subtotal_minor: string; service_fee_minor: string; total_minor: string; expires_at: string;
  lines: { item_id: string; quantity: number; listing_currency: string; listing_line_minor: string; charged_minor: string; rate_per_usd: string | null; rate_published_at: string | null }[];
};
export const getQuote = (input: { lines: { item_id: string; quantity: number }[]; client_key: string }) =>
  apiFetch<{ quote: Quote; reused: boolean }>('/api/marketplace/quote', { method: 'POST', body: input });

export const getSellerEarningsByCurrency = (token: string) =>
  apiFetch<{ balances: { currency: string; pending_micro: number; on_hold_micro: number; withdrawable_micro: number; orders: number }[] }>(
    '/api/marketplace/seller-earnings', { token });
