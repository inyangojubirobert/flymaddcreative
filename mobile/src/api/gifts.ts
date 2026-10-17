import { apiFetch } from '../lib/api-client';

// Dream Coins, virtual gifts and recognition - pages/api/onedream/gifts/**
// and pages/api/onedream/rewards/**. Gift costs and coins per package come
// from the server; prices come from Google Play. Dream Coins have no cash
// value and cannot be withdrawn, transferred or used for votes or prizes.

export type CoinPackage = {
  id: string;
  name: string;
  google_play_product_id: string;
  coins_per_unit: number;
  highlight: string | null;
  purchasable: boolean;
};

export type Gift = {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  image_url: string | null;
  animation_url: string | null;
  coin_cost: number;
  category: string;
};

export type LedgerEntry = {
  id: number;
  entry_type: 'purchase_credit' | 'purchase_reversal' | 'gift_debit' | 'gift_reversal_credit' | 'admin_adjustment';
  coins: number;
  balance_after: number;
  note: string | null;
  created_at: string;
};

export type SentGift = {
  id: string;
  gift_snapshot: { name: string; emoji: string | null; image_url: string | null; coin_cost: number };
  quantity: number;
  coins_spent: number;
  message: string | null;
  is_anonymous: boolean;
  verified_buyer: boolean;
  status: 'sent' | 'reversed';
  created_at: string;
  recipient: { username: string; name: string } | null;
};

export type CoinWallet = {
  billing_enabled: boolean;
  balance: number;
  lifetime_purchased: number;
  lifetime_spent: number;
  gifting_suspended: boolean;
  purchases: {
    id: string; package_id: string; order_id: string | null; quantity: number; coins_per_unit: number; total_coins: number;
    status: 'credited' | 'partially_reversed' | 'reversed'; reversed_quantity: number; created_at: string;
  }[];
  ledger: LedgerEntry[];
  sent: SentGift[];
};

export type Recognition = {
  seller: { username: string; name: string };
  recognition_points: number;
  gifts_received: number;
  supporters: number;
  badges: { id: string; label: string }[];
  monthly: { month: string; gifts: number; points: number; supporters: number }[];
  recent_gifts: { name: string; emoji: string | null; image_url: string | null; count: number }[];
  recent: {
    id: string;
    gift: { name: string; emoji: string | null; image_url: string | null };
    quantity: number;
    recognition_points: number;
    message: string | null;
    verified_buyer: boolean;
    from: { username: string; name: string } | null;
    created_at: string;
  }[];
};

export type RewardProgram = {
  id: string;
  name: string;
  description: string | null;
  audience: string;
  criteria: Record<string, unknown>;
  reward_type: string;
  reward_label: string | null;
};

export type ProgramProgress = {
  program: RewardProgram;
  window_days: number;
  status: 'eligible' | 'in_progress' | 'not_tracked' | 'admin_review';
  metric: string | null;
  value: number | null;
  target: number | null;
  note?: string;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  name: string;
  recognition_points?: number;
  gifts?: number;
  supporters?: number;
  confirmed_sales?: number;
  reliability?: number;
};

export function getCoinPackages() {
  return apiFetch<{ billing_enabled: boolean; packages: CoinPackage[] }>('/api/onedream/gifts/packages');
}

export async function getGiftCatalogue() {
  return (await apiFetch<{ gifts: Gift[] }>('/api/onedream/gifts/catalogue')).gifts;
}

export function getCoinWallet(token: string) {
  return apiFetch<CoinWallet>('/api/onedream/gifts/history', { token });
}

export function verifyCoinPurchase(token: string, input: { productId: string; purchaseToken: string }) {
  return apiFetch<{ success: boolean; pending?: boolean; quantity?: number; total_coins?: number; balance?: number; already_credited?: boolean }>(
    '/api/onedream/gifts/verify-purchase',
    { method: 'POST', token, body: { product_id: input.productId, purchase_token: input.purchaseToken } },
  );
}

export function sendGift(token: string, input: {
  recipient_username: string; gift_id: string; quantity: number; client_request_id: string;
  message?: string; anonymous?: boolean; order_id?: string; buyer_token?: string;
}) {
  return apiFetch<{ success: boolean; already_sent: boolean; coins_spent: number; balance: number; recipient: { username: string; name: string } }>(
    '/api/onedream/gifts/send', { method: 'POST', token, body: input },
  );
}

export function getRecognition(username: string) {
  return apiFetch<Recognition>(`/api/onedream/gifts/received?username=${encodeURIComponent(username)}`);
}

export function getRewardProgress(token: string) {
  return apiFetch<{ progress: ProgramProgress[]; awards: { id: string; program_id: string; period: string; title: string; created_at: string }[] }>(
    '/api/onedream/rewards/progress', { token },
  );
}

export function getLeaderboard(board: 'most_appreciated' | 'reliable_merchants') {
  return apiFetch<{ board: string; days: number; notice: string; entries: LeaderboardEntry[] }>(`/api/onedream/rewards/leaderboards?board=${board}`);
}
