import { apiFetch } from '../lib/api-client';
import type { CatalogueOrder } from './catalogue';

// Multi-listing cart checkout - pages/api/catalogue/cart-*.js. Prices and the
// service charge are always computed server-side; the client sends only
// listing ids and quantities.

export type CartLineInput = { item_id: string; quantity: number };

export type CartQuoteLine = {
  item_id: string;
  quantity: number;
  title: string;
  image: string | null;
  seller_username: string | null;
  listing_type: 'product' | 'service';
  pricing_model: string | null;
  price_unit: string | null;
  min_order_qty: number | null;
  max_order_qty: number | null;
  unit_price_usd: number;
  line_total_usd: number;
  problem: string | null;
};

export type CartQuote = {
  lines: CartQuoteLine[];
  has_problems: boolean;
  payment_methods: ('paystack' | 'usdt')[];
  subtotal_usd: number;
  service_fee_usd: number;
  total_usd: number;
  exchange_rate: number;
  total_ngn: number;
  /** USD policy; cap_ngn is only the Paystack conversion of cap_usd. null cap = uncapped. */
  fee_policy: { percent: number; cap_usd: number | null; cap_ngn: number | null };
  checkout_enabled: boolean;
};

export type CartCheckoutResult = {
  checkout: {
    id: string;
    payment_method: 'paystack' | 'usdt';
    subtotal_usd: number;
    service_fee_usd: number;
    total_usd: number;
    amount_ngn: number | null;
    currency: 'NGN' | 'USD';
    created_at: string;
  };
  orders: (CatalogueOrder & { quantity?: number; unit_price_usd?: number })[];
  pending?: boolean;
  error?: string;
};

export function getCartQuote(lines: CartLineInput[]): Promise<CartQuote> {
  return apiFetch('/api/catalogue/cart-quote', { method: 'POST', body: { lines } });
}

export function createCartPaymentIntent(input: {
  lines: CartLineInput[];
  buyer_email: string;
  callback_url: string;
}): Promise<{ authorization_url: string; reference: string; total_usd: number; amount_ngn: number }> {
  return apiFetch('/api/catalogue/cart-payment-intent', { method: 'POST', body: input });
}

/** Resolves with `pending: true` (HTTP 202) while a USDT tx is still confirming. */
export function submitCartCheckout(input: {
  payment_method: 'paystack' | 'usdt';
  buyer_name: string;
  buyer_email: string;
  buyer_whatsapp?: string;
  notes?: string;
  payment_ref?: string;
  tx_hash?: string;
  network?: 'bsc' | 'tron';
  lines?: CartLineInput[];
}): Promise<CartCheckoutResult> {
  return apiFetch('/api/catalogue/cart-checkout', { method: 'POST', body: input });
}
