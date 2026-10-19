// Single place where paid votes are credited. Every vote route
// (pages/api/onedream/vote.js and the Paystack webhook) goes through
// creditPaidVotes(), which only credits once a payment has been verified
// server-side, and only once per payment.
//
// Prices are in USD ($2 per vote). Paystack charges in NGN, converted at the
// live rate (lib/currency.js) when the intent is created; the rate and the
// exact kobo amount are recorded with the intent so verification checks the
// charge against what was actually requested.
//
// payments.status lifecycle for vote payments:
//   initialized (Paystack intent created) | verifying (crypto, before credit)
//     -> crediting (claimed by exactly one request) -> succeeded
// Any other status (pending/completed/succeeded from older code) means the
// payment was already credited and is never credited again.

import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate, usdToKobo, usdToNgn } from './currency';
import { claimUsdtPayment, verifyAndRecordUsdtPayment } from './verifyCryptoTx';
import { PAID_VOTING_RETIRED, PAID_VOTING_RETIRED_MESSAGE } from './paidVoting';

export const VOTE_VALUE_USD = 2;
const LEGACY_NGN_RATE = 1600; // rate hardcoded into vote intents created before live conversion
const CREDITABLE = ['initialized', 'verifying'];

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export function inferNetwork(txHash, network) {
  const explicit = String(network || '').toLowerCase();
  if (explicit === 'bsc' || explicit === 'tron') return explicit;
  if (/^0x[a-fA-F0-9]{64}$/.test(txHash)) return 'bsc';
  if (/^[a-fA-F0-9]{64}$/.test(txHash)) return 'tron';
  return null;
}

/** Live-rate NGN amounts for a vote purchase. */
export async function quoteVotesNgn(voteCount) {
  const amountUsd = voteCount * VOTE_VALUE_USD;
  const rate = await getUsdToNgnRate();
  return { amountUsd, rate, amountNgn: usdToNgn(amountUsd, rate), amountKobo: usdToKobo(amountUsd, rate) };
}

/** Records a Paystack vote intent so verification never depends on client-supplied values. */
export async function recordVoteIntent({ reference, participantId, voteCount, amountUsd, amountNgn, amountKobo, rate }) {
  const { error } = await supabase.from('payments').insert({
    participant_id: participantId,
    payment_intent_id: reference,
    payment_method: 'paystack',
    amount: amountUsd,
    amount_usd: amountUsd,
    amount_ngn: amountNgn,
    exchange_rate: rate,
    currency: 'NGN',
    status: 'initialized',
    metadata: { type: 'onedream_votes', vote_count: voteCount, amount_kobo: amountKobo },
  });
  if (error) throw error;
}

/**
 * Verifies a Paystack vote payment. Uses the recorded intent when there is
 * one; references created before intents were recorded fall back to the
 * metadata Paystack stores (set server-side at initialization).
 */
export async function verifyPaystackVote(reference, participantId) {
  const { data: intent } = await supabase
    .from('payments')
    .select('*')
    .eq('payment_intent_id', reference)
    .maybeSingle();
  if (intent && !CREDITABLE.includes(intent.status)) return { alreadyProcessed: true, payment: intent };
  if (intent && String(intent.participant_id) !== String(participantId)) {
    return { error: 'This payment was made for a different participant', status: 403 };
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return { error: 'Paystack not configured', status: 500 };
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status || data.data?.status !== 'success') {
    return { error: 'Paystack payment verification failed', status: 400 };
  }
  if (data.data.currency !== 'NGN') return { error: 'Unexpected payment currency', status: 400 };

  let meta = data.data.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = null; }
  }

  let voteCount;
  let expectedKobo;
  let rate;
  if (intent) {
    voteCount = Number(intent.metadata?.vote_count);
    expectedKobo = Number(intent.metadata?.amount_kobo);
    rate = Number(intent.exchange_rate);
  } else {
    if (meta?.type !== 'onedream_votes' || String(meta?.participant_id || '') !== String(participantId)) {
      return { error: 'Payment was not created for votes for this participant', status: 400 };
    }
    voteCount = Number(meta.vote_count);
    rate = Number(meta.exchange_rate) || LEGACY_NGN_RATE;
    expectedKobo = usdToKobo(voteCount * VOTE_VALUE_USD, rate);
  }
  if (!Number.isInteger(voteCount) || voteCount < 1 || !(expectedKobo > 0)) {
    return { error: 'Invalid vote payment record', status: 400 };
  }

  const paidKobo = Number(data.data.amount);
  if (paidKobo < expectedKobo * 0.98) {
    console.error('[votes] Paystack amount too low', { reference, paidKobo, expectedKobo });
    return { error: 'Paid amount does not match the vote purchase', status: 400 };
  }

  return {
    voteCount,
    amountUsd: voteCount * VOTE_VALUE_USD,
    amountNgn: paidKobo / 100,
    rate,
    currency: 'NGN',
  };
}

/** Verifies a USDT vote payment on-chain. Votes = floor(amount / $2). */
export async function verifyUsdtVote(txHash, network, participantId) {
  const net = inferNetwork(txHash, network);
  if (!net) return { error: 'Unknown network - send network: "bsc" or "tron"', status: 400 };
  const result = await verifyAndRecordUsdtPayment({ txHash, network: net, userId: participantId });
  if (!result.verified) {
    return {
      error: result.error || 'USDT payment is not confirmed yet',
      status: result.status || 400,
      pending: !!result.pending,
      confirmations: result.confirmations,
      required: result.required,
    };
  }
  const payment = result.payment;
  if (payment.consumed_for && !(payment.consumed_for === 'votes' && payment.consumed_ref === String(participantId))) {
    return { error: 'This transaction has already been used for another payment', status: 409 };
  }
  const amountUsd = Number(payment.amount);
  const voteCount = Math.floor(amountUsd / VOTE_VALUE_USD);
  if (voteCount < 1) return { error: `Minimum is $${VOTE_VALUE_USD} (one vote)`, status: 400 };
  return { voteCount, amountUsd, network: net, currency: 'USD' };
}

/**
 * Credits verified votes exactly once per payment reference.
 * Returns { votesCredited, alreadyProcessed, payment } or { error, status }.
 */
export async function creditPaidVotes({
  participantId,
  paymentIntentId,
  paymentMethod,
  voteCount,
  amountUsd,
  amountNgn = null,
  rate = null,
  currency,
  network = null,
  voterInfo = null,
}) {
  if (PAID_VOTING_RETIRED) return { error: PAID_VOTING_RETIRED_MESSAGE, status: 410 };
  const isUsdt = paymentMethod === 'crypto';

  // 1. Get or create the payment row - payment_intent_id is unique.
  let row;
  let created = false;
  const inserted = await supabase
    .from('payments')
    .insert({
      participant_id: participantId,
      payment_intent_id: paymentIntentId,
      payment_method: paymentMethod,
      amount: amountUsd,
      amount_usd: amountUsd,
      amount_ngn: amountNgn,
      exchange_rate: rate,
      currency,
      status: 'verifying',
      metadata: { type: 'onedream_votes', vote_count: voteCount, network },
    })
    .select()
    .single();
  if (!inserted.error) {
    row = inserted.data;
    created = true;
  } else if (inserted.error.code === '23505') {
    const existing = await supabase.from('payments').select('*').eq('payment_intent_id', paymentIntentId).single();
    if (existing.error) throw existing.error;
    row = existing.data;
  } else {
    throw inserted.error;
  }

  if (String(row.participant_id) !== String(participantId)) {
    return { error: 'This payment was made for a different participant', status: 403 };
  }
  if (!CREDITABLE.includes(row.status)) return { alreadyProcessed: true, payment: row };

  // 2. USDT: claim the transaction in the shared registry.
  if (isUsdt) {
    const claim = await claimUsdtPayment(paymentIntentId, 'votes', participantId);
    if (claim === 'taken') {
      await supabase.from('payments').update({ status: 'rejected' }).eq('id', row.id).eq('status', row.status);
      return { error: 'This transaction has already been used for another payment', status: 409 };
    }
    if (claim === 'already_claimed' && created) {
      // Claimed for votes before this payments row existed: credited by the
      // previous vote route. Record it, never credit twice.
      await supabase.from('payments').update({ status: 'succeeded', verified_at: new Date().toISOString() }).eq('id', row.id);
      return { alreadyProcessed: true, payment: row };
    }
    if (claim === 'not_found' || claim === 'not_confirmed') {
      return { error: 'USDT payment is not confirmed yet', status: 400 };
    }
  }

  // 3. Exactly one request wins the right to credit.
  const { data: claimed, error: claimError } = await supabase
    .from('payments')
    .update({ status: 'crediting', amount: amountUsd, amount_usd: amountUsd, amount_ngn: amountNgn, exchange_rate: rate })
    .eq('id', row.id)
    .in('status', CREDITABLE)
    .select()
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { alreadyProcessed: true, payment: row };

  // 4. Credit. On failure, undo and release the claim so a retry can credit.
  const { data: before } = await supabase.from('participants').select('total_votes').eq('id', participantId).single();
  const now = new Date().toISOString();
  const voteRows = Array.from({ length: voteCount }, () => ({
    participant_id: participantId,
    payment_id: row.id,
    voter_ip: voterInfo?.ip || null,
    voter_user_agent: voterInfo?.userAgent || null,
    created_at: now,
  }));
  const votesInsert = await supabase.from('votes').insert(voteRows);
  if (votesInsert.error) {
    await supabase.from('payments').update({ status: 'verifying' }).eq('id', row.id);
    throw votesInsert.error;
  }
  const increment = await supabase.rpc('increment_votes', { p_participant_id: participantId, p_vote_count: voteCount });
  if (increment.error) {
    await supabase.from('votes').delete().eq('payment_id', row.id);
    await supabase.from('payments').update({ status: 'verifying' }).eq('id', row.id);
    throw increment.error;
  }

  const { data: payment } = await supabase
    .from('payments')
    .update({ status: 'succeeded', verified_at: now })
    .eq('id', row.id)
    .select()
    .single();

  const oldVotes = Number(before?.total_votes) || 0;
  const milestones = await checkAndRecordMilestones(participantId, oldVotes, oldVotes + voteCount);
  return { votesCredited: voteCount, payment: payment || claimed, milestones };
}

// Records milestones a participant crossed with this purchase.
async function checkAndRecordMilestones(participantId, oldVotes, newVotes) {
  try {
    const { data: milestones, error: fetchError } = await supabase
      .from('milestones')
      .select('id, name, vote_threshold, stage, badge_icon')
      .eq('is_active', true)
      .order('vote_threshold', { ascending: true });
    if (fetchError || !milestones) return [];

    const { data: achieved } = await supabase
      .from('participant_milestones')
      .select('milestone_id')
      .eq('participant_id', participantId);
    const achievedIds = new Set((achieved || []).map((a) => a.milestone_id));

    const newlyAchieved = milestones.filter((m) => oldVotes < m.vote_threshold && newVotes >= m.vote_threshold && !achievedIds.has(m.id));
    if (!newlyAchieved.length) return [];

    const { error: insertError } = await supabase.from('participant_milestones').insert(newlyAchieved.map((m) => ({
      participant_id: participantId,
      milestone_id: m.id,
      votes_at_achievement: newVotes,
      achieved_at: new Date().toISOString(),
      notified: false,
    })));
    if (insertError) console.error('Error recording milestone achievements:', insertError);

    const userStages = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
    const stageMilestones = newlyAchieved.filter((m) => userStages.includes(m.stage?.toLowerCase()));
    if (stageMilestones.length) {
      await supabase.from('participants').update({ current_stage: stageMilestones[stageMilestones.length - 1].name }).eq('id', participantId);
    }

    return newlyAchieved.map((m) => ({ id: m.id, name: m.name, stage: m.stage, icon: m.badge_icon }));
  } catch (error) {
    console.error('Milestone check error:', error);
    return [];
  }
}
