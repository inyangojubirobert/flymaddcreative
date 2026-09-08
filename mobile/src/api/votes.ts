import { apiFetch } from '../lib/api-client';

export const VOTE_VALUE_USD = 2; // must match VOTE_VALUE across the backend (vote.js, create-payment-intent.js, etc.)

export type CreatePaystackIntentResult = {
  authorization_url: string;
  reference: string;
  payment_intent_id: string;
  amount: number;
  amount_ngn: number;
  amount_kobo: number;
  exchange_rate: number;
  public_key: string;
};

export async function createPaystackIntent(input: {
  participant_id: string;
  vote_count: number;
  callback_url: string;
}): Promise<CreatePaystackIntentResult> {
  return apiFetch('/api/onedream/create-payment-intent', {
    method: 'POST',
    body: { ...input, payment_method: 'paystack' },
  });
}

export type UsdtVerifyResult =
  | { success: true; payment: { amount: number; vote_count: number; network: string }; votes_available: number }
  | { success: false; pending: boolean; confirmations?: number; required?: number; error?: string };

export async function verifyUsdtPayment(input: {
  token: string;
  tx_hash: string;
  network: 'bsc' | 'tron';
  expected_amount?: number;
}): Promise<UsdtVerifyResult> {
  const { token, ...body } = input;
  return apiFetch('/api/onedream/verify-usdt-payment', { method: 'POST', token, body });
}

export type VoteResult = {
  success: boolean;
  message: string;
  participant: { total_votes: number; name: string; username: string; current_stage?: string };
  votes_recorded: number;
  milestones_achieved: { id: string; name: string; icon?: string }[] | null;
};

export async function submitVote(input: {
  token: string;
  participant_id: string;
  vote_count: number;
  payment_amount: number;
  payment_method: 'paystack' | 'crypto';
  payment_intent_id: string;
  network?: 'bsc' | 'tron';
}): Promise<VoteResult> {
  const { token, ...body } = input;
  return apiFetch('/api/onedream/vote', { method: 'POST', token, body });
}

export async function getExchangeRate(): Promise<{ rate: number }> {
  return apiFetch('/api/exchange-rate');
}
