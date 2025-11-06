// API endpoint to record PAID votes for One Dream Initiative
// Each vote costs $2, multiple votes allowed per user
// Requires payment verification before recording vote
// Supports Stripe, PayStack, and Crypto payments

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

// Initialize Supabase client with service role for secure operations
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''  // Use service role for write operations
);

const VOTE_VALUE = 2; // $2 per vote

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      participant_id, 
      vote_count = 1, 
      payment_amount, 
      payment_method = 'stripe',
      payment_intent_id,
      payment_status = 'pending',
      voter_info 
    } = req.body;

    // Validate required fields
    if (!participant_id || !payment_amount || !payment_intent_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: participant_id, payment_amount, payment_intent_id' 
      });
    }

    // Validate payment amount matches vote count
    const expectedAmount = vote_count * VOTE_VALUE;
    if (payment_amount !== expectedAmount) {
      return res.status(400).json({ 
        error: `Payment amount $${payment_amount} does not match expected $${expectedAmount} for ${vote_count} votes` 
      });
    }

    // ✅ Confirm participant exists
    const { data: participant, error: findError } = await supabase
      .from('participants')
      .select('*')
      .eq('id', participant_id)
      .single();

    if (findError || !participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // ✅ STEP 2: Verify payment was successful
    let paymentVerification;
    try {
      if (payment_method === 'stripe') {
        // Verify Stripe payment
        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
        if (paymentIntent.status !== 'succeeded') {
          return res.status(400).json({ 
            error: 'Payment not completed',
            payment_status: paymentIntent.status 
          });
        }
        paymentVerification = {
          verified: true,
          amount: paymentIntent.amount / 100,
          metadata: paymentIntent.metadata
        };
      } else if (payment_method === 'paystack') {
        // Verify PayStack payment
        const response = await fetch(`https://api.paystack.co/transaction/verify/${payment_intent_id}`, {
          headers: {
            'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          }
        });
        const data = await response.json();
        
        if (!data.status || data.data.status !== 'success') {
          return res.status(400).json({ 
            error: 'PayStack payment verification failed',
            payment_status: data.data?.status 
          });
        }
        paymentVerification = {
          verified: true,
          amount: data.data.amount / 100,
          metadata: data.data.metadata
        };
      } else if (payment_method === 'crypto') {
        // For crypto, we trust the frontend verification for now
        // In production, you'd verify blockchain transactions
        paymentVerification = {
          verified: true,
          amount: vote_count * 2, // $2 per vote
          metadata: { type: 'crypto', reference: payment_intent_id }
        };
      } else {
        return res.status(400).json({ error: 'Unsupported payment method' });
      }
    } catch (verifyError) {
      console.error('Payment verification error:', verifyError);
      return res.status(400).json({ 
        error: 'Payment verification failed',
        details: verifyError.message 
      });
    }

    // ✅ Record payment first (this creates the payment record)
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert([{
        participant_id,
        amount: payment_amount,
        currency: 'USD',
        payment_method,
        payment_intent_id,
        status: payment_status,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (paymentError) {
      console.error('Payment record error:', paymentError);
      return res.status(500).json({ error: 'Failed to record payment' });
    }

    // ✅ Record votes (multiple votes for the payment)
    const votes = [];
    for (let i = 0; i < vote_count; i++) {
      votes.push({
        participant_id,
        payment_id: payment.id,  // Link vote to payment
        voter_ip: voter_info?.ip || null,
        voter_user_agent: voter_info?.userAgent || null,
        created_at: new Date().toISOString()
      });
    }

    const { data: newVotes, error: votesError } = await supabase
      .from('votes')
      .insert(votes)
      .select();

    if (votesError) {
      console.error('Votes insert error:', votesError);
      return res.status(500).json({ error: 'Failed to record votes' });
    }

    // ✅ Update total votes count in participants table
    const { error: updateError } = await supabase
      .from('participants')
      .update({ 
        total_votes: participant.total_votes + vote_count,
        updated_at: new Date().toISOString()
      })
      .eq('id', participant_id);

    if (updateError) {
      console.error('Vote count update error:', updateError);
      // Votes were recorded but count update failed - log for manual fix
    }

    // ✅ Record analytics event
    await supabase
      .from('analytics_events')
      .insert([{
        participant_id,
        event_type: 'votes_purchased',
        event_data: {
          payment_id: payment.id,
          vote_count,
          amount_paid: payment_amount,
          payment_method,
          voter_ip: voter_info?.ip,
          timestamp: new Date().toISOString()
        }
      }]);

    // ✅ Get updated participant data for response
    const { data: updatedParticipant } = await supabase
      .from('participants')
      .select('total_votes, name, username')
      .eq('id', participant_id)
      .single();

    return res.status(200).json({ 
      success: true, 
      message: `${vote_count} votes recorded successfully`,
      participant: updatedParticipant,
      payment: {
        id: payment.id,
        amount: payment_amount,
        votes_purchased: vote_count,
        vote_value: VOTE_VALUE
      },
      votes_recorded: newVotes.length
    });

  } catch (err) {
    console.error('Paid vote API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}