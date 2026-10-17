import { apiFetch } from '../lib/api-client';

export type Withdrawal = {
  id: string;
  amount_usd: number;
  payment_method: string;
  payment_details: string;
  status: 'pending' | 'processing' | 'paid' | 'rejected';
  created_at: string;
};

export type WalletSummary = {
  earned: number;
  withdrawn: number;
  available_balance: number;
  withdrawals: Withdrawal[];
};

export async function getWalletSummary(token: string): Promise<WalletSummary> {
  return apiFetch('/api/onedream/withdraw', { token });
}

export async function requestWithdrawal(
  token: string,
  input: { amount: number; method: string; details: string }
): Promise<{ success: boolean; withdrawal_id: string; available_balance: number }> {
  return apiFetch('/api/onedream/withdraw', { method: 'POST', token, body: input });
}

// --- Marketplace earnings (seller ledger) - /api/onedream/marketplace-wallet ---

export type LedgerState = 'pending' | 'on_hold' | 'withdrawable' | 'excluded';

export type MarketplaceSale = {
  order_id: string;
  item_id: string;
  title: string;
  image: string | null;
  listing_type: 'product' | 'service';
  quantity: number;
  gross_usd: number;
  commission_percent: number;
  commission_usd: number;
  net_usd: number;
  order_status: 'paid' | 'pending_verification' | 'buyer_confirmed' | 'disputed' | 'released';
  ledger_state: LedgerState;
  created_at: string;
  buyer_confirmed_at: string | null;
  disputed_at: string | null;
  /** P9: naira-settled sales carry their real figures here (the *_usd fields are equivalents). */
  settlement_currency?: 'USD' | 'NGN';
  gross_local?: number;
  commission_local?: number;
  net_local?: number;
};

export type MarketplaceWithdrawal = {
  id: string;
  amount_usd: number;
  amount_ngn?: number | null;
  currency?: 'USD' | 'NGN';
  payment_method: string;
  status: 'pending' | 'processing' | 'claimed' | 'paid' | 'rejected';
  created_at: string;
  payout_reference: string | null;
  payout_confirmed_at: string | null;
  admin_note: string | null;
};

export type MarketplaceWallet = {
  currency: 'USD';
  completed_sales_usd: number;
  commission_deducted_usd: number;
  earned_withdrawable_usd: number;
  pending_earnings_usd: number;
  pending_orders: number;
  on_hold_usd: number;
  withdrawals_pending_usd: number;
  withdrawals_paid_usd: number;
  available_usd: number;
  balance_owed_usd: number;
  legacy_orders: number;
  /** P9: naira earnings (multi-currency listings), withdrawn in naira. */
  naira?: {
    completed_sales_ngn: number; commission_deducted_ngn: number; pending_earnings_ngn: number; pending_orders: number;
    on_hold_ngn: number; withdrawals_pending_ngn: number; withdrawals_paid_ngn: number; available_ngn: number; balance_owed_ngn: number;
  };
  sales: MarketplaceSale[];
  withdrawals: MarketplaceWithdrawal[];
};

export function getMarketplaceWallet(token: string): Promise<MarketplaceWallet> {
  return apiFetch('/api/onedream/marketplace-wallet', { token });
}

export function requestMarketplaceWithdrawal(
  token: string,
  input: { amount: number; method: string; details: string; currency?: 'USD' | 'NGN' }
): Promise<{ success: boolean; withdrawal_id: string; available_usd?: number; available_ngn?: number }> {
  return apiFetch('/api/onedream/marketplace-wallet', { method: 'POST', token, body: input });
}

// --- Private contact (never public) - /api/onedream/private-contact ---

export type PrivateContact = { phone: string | null; whatsapp: string | null; updated_at: string };

export async function getPrivateContact(token: string): Promise<PrivateContact | null> {
  const data = await apiFetch<{ contact: PrivateContact | null }>('/api/onedream/private-contact', { token });
  return data.contact;
}

export async function savePrivateContact(token: string, input: { phone: string; whatsapp?: string }): Promise<PrivateContact> {
  const data = await apiFetch<{ contact: PrivateContact }>('/api/onedream/private-contact', { method: 'POST', token, body: input });
  return data.contact;
}
