// Shared I/O for Dream Coins, virtual gifts and recognition
// (pages/api/onedream/gifts/**, pages/api/onedream/rewards/**,
// pages/api/admin/gifts/**). Rules: lib/dreamCoinsRules.js. Schema and the
// money-safe SQL functions: supabase/add_dream_coins_gifting.sql.
//
// Google Play: the one-time product helpers from lib/adsGooglePlay.js and the
// credentials from lib/aiPayments.js are imported, never changed. The only
// Google call of our own is the voided-purchases listing, because coin
// refunds must include quantity-based partial refunds.
//
// Switch: DREAM_COINS_ENABLED=true turns on coin sales. Off by default until
// the Google Play policy review (docs/DREAM_COINS_POLICY_READINESS.md) is
// signed off. Spending coins already owned and viewing recognition do not
// depend on it.

import { createClient } from '@supabase/supabase-js';
import { GOOGLE_PLAY_PACKAGE_NAME, getGooglePlayAccessToken } from './aiPayments';
import { consumeProductPurchase, getProductPurchase } from './adsGooglePlay';

export const giftsDb = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export function dreamCoinsEnabled() {
  return process.env.DREAM_COINS_ENABLED === 'true';
}

export const GIFT_LIMITS = {
  perHour: Number(process.env.VIRTUAL_GIFT_MAX_PER_HOUR) || 30,
  coinsPerDay: Number(process.env.VIRTUAL_GIFT_MAX_COINS_PER_DAY) || 50000,
};

export const programFields = 'id, name, description, audience, criteria, reward_type, reward_label, sort_order';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function publicPackage(pkg) {
  return {
    id: pkg.id,
    name: pkg.name,
    google_play_product_id: pkg.google_play_product_id,
    coins_per_unit: pkg.coins_per_unit,
    highlight: pkg.highlight,
    purchasable: dreamCoinsEnabled() && !!pkg.is_active,
  };
}

export function publicGift(gift) {
  return {
    id: gift.id,
    name: gift.name,
    description: gift.description,
    emoji: gift.emoji,
    image_url: gift.image_url,
    animation_url: gift.animation_url,
    coin_cost: gift.coin_cost,
    category: gift.category,
  };
}

export async function getBalanceRow(participantId) {
  return must(await giftsDb.from('dream_coin_balances').select('balance, lifetime_purchased, lifetime_spent, gifting_suspended')
    .eq('participant_id', participantId).maybeSingle());
}

/** Dependencies for processCoinPurchase (lib/dreamCoinsRules.js). */
export const coinPurchaseDeps = {
  enabled: dreamCoinsEnabled,
  async findPackageByProduct(productId) {
    return must(await giftsDb.from('dream_coin_packages').select('*').eq('google_play_product_id', productId).maybeSingle());
  },
  async findPurchaseByToken(token) {
    return must(await giftsDb.from('dream_coin_purchases')
      .select('id, participant_id, quantity, coins_per_unit, total_coins, consumption_state').eq('purchase_token', token).maybeSingle());
  },
  async getBalance(participantId) {
    return (await getBalanceRow(participantId))?.balance ?? 0;
  },
  getPurchase: getProductPurchase,
  consume: consumeProductPurchase,
  async credit(input) {
    const { data, error } = await giftsDb.rpc('dream_coins_credit_purchase', {
      p_participant_id: input.participantId,
      p_package_id: input.packageId,
      p_product_id: input.productId,
      p_purchase_token: input.purchaseToken,
      p_order_id: input.orderId,
      p_quantity: input.quantity,
      p_is_test: input.isTest,
      p_purchased_at: input.purchasedAt,
    });
    if (error && String(error.message).includes('purchase_owned_by_other_account')) return { conflict: true };
    if (error) throw error;
    return { row: data };
  },
  async recordConsumption(token, state) {
    must(await giftsDb.rpc('dream_coins_record_consumption', { p_purchase_token: token, p_state: state }));
  },
};

/**
 * Refunded / charged-back / revoked one-time purchases since startTimeMs,
 * including quantity-based partial refunds (voidedQuantity).
 */
export async function listVoidedCoinPurchases(startTimeMs) {
  const accessToken = await getGooglePlayAccessToken();
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}`;
  const voided = [];
  let token = '';
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ type: '0', maxResults: '1000', startTime: String(startTimeMs), includeQuantityBasedPartialRefund: 'true' });
    if (token) query.set('token', token);
    const response = await fetch(`${base}/purchases/voidedpurchases?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `google_play_${response.status}`);
      error.status = response.status;
      throw error;
    }
    voided.push(...(data.voidedPurchases || []));
    token = data.tokenPagination?.nextPageToken || '';
    if (!token) break;
  }
  return voided;
}

/** Writes an admin action to the append-only audit log. Never blocks the action itself. */
export async function auditAdmin(adminId, action, targetType, targetId, details = {}) {
  const { error } = await giftsDb.from('dream_gifting_admin_audit')
    .insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId ? String(targetId) : null, details });
  if (error) console.error('dream gifting audit failed:', error.message);
}

export async function participantByUsername(username) {
  return must(await giftsDb.from('participants').select('id, username, name').eq('username', String(username).toLowerCase()).maybeSingle());
}

/**
 * Seller performance from marketplace orders - read only. Delivered means the
 * buyer confirmed (or funds were released); disputes count against reliability.
 */
export async function sellerOrderMetrics(username, windowDays = 180) {
  const since = new Date(Date.now() - windowDays * 86400e3).toISOString();
  const orders = must(await giftsDb.from('catalogue_orders').select('status').eq('seller_username', username).gte('created_at', since).limit(5000)) || [];
  const confirmed = orders.filter((o) => ['buyer_confirmed', 'released'].includes(o.status)).length;
  const disputed = orders.filter((o) => o.status === 'disputed').length;
  const settled = confirmed + disputed;
  return { total_orders: settled, confirmed_sales: confirmed, disputed_orders: disputed, delivery_reliability: settled ? confirmed / settled : 0 };
}

/** Appreciation received by a participant (sent gifts only; reversed ones are excluded). */
export async function recognitionSummary(participantId, windowDays = null) {
  let query = giftsDb.from('virtual_gift_transactions').select('sender_id, recognition_points, created_at')
    .eq('recipient_id', participantId).eq('status', 'sent').limit(10000);
  if (windowDays) query = query.gte('created_at', new Date(Date.now() - windowDays * 86400e3).toISOString());
  const rows = must(await query) || [];
  return {
    points: rows.reduce((sum, r) => sum + r.recognition_points, 0),
    gifts: rows.length,
    supporters: new Set(rows.map((r) => r.sender_id)).size,
    rows,
  };
}
