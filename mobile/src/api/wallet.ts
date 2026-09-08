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
