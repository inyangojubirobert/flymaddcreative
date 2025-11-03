// API endpoint to record votes
// Accepts { token, amount, source } and computes votes based on VOTE_VALUE
// Validates referral token and increments onedream_votes table

import { createClient } from '@supabase/supabase-js';
import { 
  calcVotesFromAmount, 
  getUserByReferralToken, 
  recordVote, 
  checkRateLimit,
  VOTE_VALUE 
} from '../../../lib/onedreamHelpers';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - max 20 vote requests per IP per minute
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(`vote_${clientIP}`, 20, 60 * 1000)) {
    return res.status(429).json({ 
      error: 'Too many requests. Please slow down.' 
    });
  }

  const { token, amount, source, referrerToken } = req.body;

  // Validate required fields
  if (!token) {
    return res.status(400).json({ 
      error: 'Referral token is required' 
    });
  }

  if (!source) {
    return res.status(400).json({ 
      error: 'Vote source is required (payment, visit, referral)' 
    });
  }

  try {
    // Find user by referral token
    const user = await getUserByReferralToken(token);
    if (!user) {
      return res.status(404).json({ 
        error: 'Invalid referral token' 
      });
    }

    // Calculate votes based on amount or default to 1
    let votes = 1;
    let amountUsd = 0;

    if (amount && amount > 0) {
      votes = calcVotesFromAmount(amount);
      amountUsd = amount;
    } else if (source === 'visit' && !process.env.ALLOW_FREE_VISITS_AS_VOTE) {
      return res.status(400).json({ 
        error: 'Free visit votes are not enabled. Payment required.' 
      });
    }

    // Find referrer if referrerToken is provided
    let referrerId = null;
    if (referrerToken && referrerToken !== token) {
      const referrer = await getUserByReferralToken(referrerToken);
      if (referrer) {
        referrerId = referrer.id;
      }
    }

    // Record the vote
    const voteRecord = await recordVote({
      userId: user.id,
      votes,
      amountUsd,
      source,
      referrerId
    });

    // If there's a referrer, give them a bonus vote (10% of votes)
    if (referrerId && votes > 1) {
      const bonusVotes = Math.max(1, Math.floor(votes * 0.1));
      await recordVote({
        userId: referrerId,
        votes: bonusVotes,
        amountUsd: 0,
        source: 'referral_bonus',
        referrerId: user.id
      });
    }

    // Get updated user stats
    const { data: userStats } = await supabase
      .from('onedream_user_stats')
      .select('total_votes, total_amount_usd')
      .eq('id', user.id)
      .single();

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        votesAdded: votes,
        amountUsd,
        source,
        userStats: userStats || { total_votes: votes, total_amount_usd: amountUsd },
        voteValue: VOTE_VALUE
      }
    });

  } catch (error) {
    console.error('Vote recording error:', error);
    res.status(500).json({ 
      error: 'Failed to record vote. Please try again.' 
    });
  }
}

// Alternative endpoint for batch vote recording (admin use)
export async function recordBatchVotes(votes) {
  try {
    const { data, error } = await supabase
      .from('onedream_votes')
      .insert(votes)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Batch vote recording error:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to validate vote source
function isValidVoteSource(source) {
  const validSources = ['payment', 'visit', 'referral', 'referral_bonus', 'admin'];
  return validSources.includes(source);
}

// Get vote statistics for a user
export async function getUserVoteStats(userId) {
  try {
    const { data, error } = await supabase
      .from('onedream_user_stats')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting user vote stats:', error);
    return null;
  }
}