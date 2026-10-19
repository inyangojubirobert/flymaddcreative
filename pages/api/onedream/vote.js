// Records PAID votes for One Dream Initiative ($2 per vote).
//
// Votes are credited only after the payment is verified server-side:
//   - paystack: the charge is verified with Paystack against the intent
//     recorded by create-payment-intent.js (participant, vote count, amount)
//   - crypto:   the USDT transfer is verified on-chain (lib/verifyCryptoTx.js)
//               and claimed in the shared USDT registry, so one transfer pays
//               for one thing
// The client's vote_count / payment_amount are ignored: votes come from what
// was actually paid. Each payment is credited at most once (lib/voteCredits.js),
// so retries are safe.

import { createClient } from '@supabase/supabase-js';
import { creditPaidVotes, VOTE_VALUE_USD, verifyPaystackVote, verifyUsdtVote } from '../../../lib/voteCredits';
import { refuseRetiredVoting } from '../../../lib/paidVoting';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (refuseRetiredVoting(res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { participant_id, payment_method, payment_intent_id, network, voter_info } = req.body || {};
    const reference = typeof payment_intent_id === 'string' ? payment_intent_id.trim() : '';

    if (!participant_id || !reference) {
      return res.status(400).json({ error: 'Missing required fields: participant_id, payment_intent_id' });
    }

    const { data: participant, error: findError } = await supabase
      .from('participants')
      .select('id')
      .eq('id', participant_id)
      .single();
    if (findError || !participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const method = payment_method === 'paystack' || reference.startsWith('ODI_') ? 'paystack' : 'crypto';
    const verified = method === 'paystack'
      ? await verifyPaystackVote(reference, participant_id)
      : await verifyUsdtVote(reference, network, participant_id);

    if (verified.alreadyProcessed) return respond(res, participant_id, { alreadyProcessed: true, payment: verified.payment });
    if (verified.error) {
      // Pending confirmations -> 425 (not 202): clients treat any 2xx as "votes recorded".
      return res.status(verified.pending ? 425 : (verified.status || 400)).json({
        success: false,
        error: verified.pending ? 'Your transaction is still confirming. Try again in a minute.' : verified.error,
        message: verified.pending ? 'Your transaction is still confirming. Try again in a minute.' : verified.error,
        pending: verified.pending || false,
        confirmations: verified.confirmations,
        required: verified.required,
      });
    }

    const result = await creditPaidVotes({
      participantId: participant_id,
      paymentIntentId: reference,
      paymentMethod: method,
      voteCount: verified.voteCount,
      amountUsd: verified.amountUsd,
      amountNgn: verified.amountNgn ?? null,
      rate: verified.rate ?? null,
      currency: verified.currency,
      network: verified.network ?? null,
      voterInfo: voter_info,
    });
    if (result.error) return res.status(result.status || 400).json({ success: false, error: result.error, message: result.error });

    if (result.votesCredited) {
      await supabase.from('analytics_events').insert([{
        participant_id,
        event_type: 'votes_purchased',
        event_data: {
          payment_id: result.payment?.id,
          vote_count: result.votesCredited,
          amount_paid_usd: verified.amountUsd,
          payment_method: method,
          milestones_achieved: result.milestones,
          timestamp: new Date().toISOString(),
        },
      }]).then(({ error }) => { if (error) console.error('analytics insert error:', error.message); });
    }

    return respond(res, participant_id, result);
  } catch (err) {
    console.error('Paid vote API error:', err);
    return res.status(500).json({ error: 'Vote recording failed. If you were charged, try again - you will not be charged twice.' });
  }
}

async function respond(res, participantId, result) {
  const { data: participant } = await supabase
    .from('participants')
    .select('total_votes, name, username, current_stage')
    .eq('id', participantId)
    .single();
  const votes = result.votesCredited || Number(result.payment?.metadata?.vote_count) || 0;
  return res.status(200).json({
    success: true,
    already_processed: !!result.alreadyProcessed,
    message: result.alreadyProcessed ? 'This payment has already been recorded' : `${votes} votes recorded successfully`,
    participant,
    payment: {
      id: result.payment?.id,
      amount: Number(result.payment?.amount_usd ?? result.payment?.amount) || votes * VOTE_VALUE_USD,
      votes_purchased: votes,
      vote_value: VOTE_VALUE_USD,
    },
    votes_recorded: result.alreadyProcessed ? 0 : votes,
    milestones_achieved: result.milestones?.length ? result.milestones : null,
  });
}
