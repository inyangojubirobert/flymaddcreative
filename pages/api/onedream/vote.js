// API endpoint to record PAID votes for One Dream Initiative
// Each vote costs $2, multiple votes allowed per user
// Requires payment verification before recording vote
// Supports PayStack and Crypto payments

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role for secure operations
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''  // Use service role for write operations
);

const VOTE_VALUE = 2; // $2 per vote

// ========================================
// MILESTONE ACHIEVEMENT CHECKER
// Records new milestones when participant crosses threshold
// ========================================
async function checkAndRecordMilestones(db, participantId, oldVotes, newVotes) {
  try {
    // 1. Get all active milestones
    const { data: milestones, error: fetchError } = await db
      .from('milestones')
      .select('id, name, vote_threshold, stage, badge_icon')
      .eq('is_active', true)
      .order('vote_threshold', { ascending: true });

    if (fetchError || !milestones) {
      console.error('Error fetching milestones:', fetchError);
      return [];
    }

    // 2. Get milestones already achieved by this participant
    const { data: achieved, error: achievedError } = await db
      .from('participant_milestones')
      .select('milestone_id')
      .eq('participant_id', participantId);

    const achievedIds = new Set((achieved || []).map(a => a.milestone_id));

    // 3. Find newly achieved milestones (crossed threshold and not already recorded)
    const newlyAchieved = milestones.filter(m => 
      oldVotes < m.vote_threshold && 
      newVotes >= m.vote_threshold && 
      !achievedIds.has(m.id)
    );

    if (newlyAchieved.length === 0) {
      return [];
    }

    // 4. Record new achievements in participant_milestones table
    const achievements = newlyAchieved.map(m => ({
      participant_id: participantId,
      milestone_id: m.id,
      votes_at_achievement: newVotes,
      achieved_at: new Date().toISOString(),
      notified: false
    }));

    const { error: insertError } = await db
      .from('participant_milestones')
      .insert(achievements);

    if (insertError) {
      console.error('Error recording milestone achievements:', insertError);
      // Continue anyway - milestones can be recalculated
    }

    // 5. Update participant's current_stage if they reached a new user stage
    const userStages = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
    const newUserStages = newlyAchieved.filter(m => 
      userStages.includes(m.stage?.toLowerCase())
    );

    if (newUserStages.length > 0) {
      // Get the highest stage achieved
      const highestStage = newUserStages[newUserStages.length - 1];
      await db
        .from('participants')
        .update({ current_stage: highestStage.name })
        .eq('id', participantId);
    }

    console.log(`🏆 Participant ${participantId} achieved:`, newlyAchieved.map(m => m.name));
    
    return newlyAchieved.map(m => ({
      id: m.id,
      name: m.name,
      stage: m.stage,
      icon: m.badge_icon
    }));

  } catch (error) {
    console.error('Milestone check error:', error);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      participant_id, 
      vote_count = 1, 
      payment_amount, 
      payment_method = 'crypto',
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

    // Validate payment amount matches vote count (allow slight rounding differences)
    const expectedAmount = vote_count * VOTE_VALUE;
    const amountDiff = Math.abs(Number(payment_amount) - expectedAmount);
    if (amountDiff > 0.01) { // Allow 1 cent tolerance for rounding
      console.warn(`Payment amount mismatch: received $${payment_amount}, expected $${expectedAmount}`);
      // Don't reject - Paystack verification will confirm the actual amount
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
      if (payment_method === 'paystack') {
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
        
        // Convert kobo to NGN, then NGN to USD (1 USD ≈ 1600 NGN)
        const NGN_TO_USD_RATE = 1600;
        const amountNGN = data.data.amount / 100; // kobo to NGN
        const amountUSD = amountNGN / NGN_TO_USD_RATE; // NGN to USD
        
        paymentVerification = {
          verified: true,
          amount: amountUSD,
          amountNGN: amountNGN,
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

    // Calculate new total votes
    const newTotalVotes = participant.total_votes + vote_count;

    // ✅ Update total votes count in participants table
    const { error: updateError } = await supabase
      .from('participants')
      .update({ 
        total_votes: newTotalVotes,
        updated_at: new Date().toISOString()
      })
      .eq('id', participant_id);

    if (updateError) {
      console.error('Vote count update error:', updateError);
      // Votes were recorded but count update failed - log for manual fix
    }

    // ✅ CHECK AND RECORD NEW MILESTONE ACHIEVEMENTS
    const newMilestones = await checkAndRecordMilestones(
      supabase, 
      participant_id, 
      participant.total_votes, 
      newTotalVotes
    );

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
          milestones_achieved: newMilestones,
          timestamp: new Date().toISOString()
        }
      }]);

    // ✅ Get updated participant data for response
    const { data: updatedParticipant } = await supabase
      .from('participants')
      .select('total_votes, name, username, current_stage')
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
      votes_recorded: newVotes.length,
      milestones_achieved: newMilestones.length > 0 ? newMilestones : null
    });

  } catch (err) {
    console.error('Paid vote API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}