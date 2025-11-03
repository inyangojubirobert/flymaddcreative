// One Dream Initiative Helper Functions
// Utility functions for vote calculations, rankings, and data operations

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Constants
export const VOTE_VALUE = parseInt(process.env.VOTE_VALUE) || 2;
export const GOAL_VOTES = parseInt(process.env.GOAL_VOTES) || 1000000;
export const ALLOW_FREE_VISITS_AS_VOTE = process.env.ALLOW_FREE_VISITS_AS_VOTE === 'true';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

/**
 * Generate a unique referral token for a user
 * @param {string} userId - The user's UUID
 * @returns {string} - A unique referral token
 */
export function generateReferralToken(userId) {
  // Create a unique token combining UUID and timestamp
  const timestamp = Date.now().toString(36);
  const randomPart = uuidv4().split('-')[0];
  return `${randomPart}${timestamp}`.toLowerCase();
}

/**
 * Calculate votes from monetary amount
 * @param {number} amount - Dollar amount
 * @returns {number} - Number of votes
 */
export function calcVotesFromAmount(amount) {
  return Math.floor(amount / VOTE_VALUE);
}

/**
 * Get user's current rank in the leaderboard
 * @param {string} userId - The user's UUID
 * @returns {Promise<{rank: number, totalVotes: number}>}
 */
export async function getUserRank(userId) {
  try {
    // Get user's total votes
    const { data: userVotes } = await supabase
      .from('onedream_user_stats')
      .select('total_votes')
      .eq('id', userId)
      .single();

    if (!userVotes) {
      return { rank: 0, totalVotes: 0 };
    }

    // Count users with more votes
    const { count } = await supabase
      .from('onedream_user_stats')
      .select('*', { count: 'exact', head: true })
      .gt('total_votes', userVotes.total_votes);

    return {
      rank: (count || 0) + 1,
      totalVotes: userVotes.total_votes || 0
    };
  } catch (error) {
    console.error('Error getting user rank:', error);
    return { rank: 0, totalVotes: 0 };
  }
}

/**
 * Get top winners for a specific period
 * @param {Object} options - Query options
 * @param {string} options.period - '7d' for last 7 days, 'all' for all time
 * @param {number} options.limit - Number of results to return (default: 10)
 * @returns {Promise<Array>} - Array of top winners
 */
export async function getTopWinners({ period = 'all', limit = 10 } = {}) {
  try {
    if (period === '7d') {
      // Get weekly winners
      const { data, error } = await supabase
        .from('onedream_weekly_winners')
        .select('*')
        .limit(limit);

      if (error) throw error;
      return data || [];
    } else {
      // Get all-time winners
      const { data, error } = await supabase
        .from('onedream_user_stats')
        .select('id, name, total_votes, total_amount_usd')
        .order('total_votes', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      return (data || []).map((user, index) => ({
        ...user,
        rank: index + 1
      }));
    }
  } catch (error) {
    console.error('Error getting top winners:', error);
    return [];
  }
}

/**
 * Get global statistics for the initiative
 * @returns {Promise<{totalVotes: number, totalValueUSD: number, totalUsers: number, progressPercent: number}>}
 */
export async function getGlobalStats() {
  try {
    // Get total votes and value
    const { data: voteStats } = await supabase
      .from('onedream_votes')
      .select('votes, amount_usd');

    const totalVotes = voteStats?.reduce((sum, vote) => sum + (vote.votes || 0), 0) || 0;
    const totalValueUSD = voteStats?.reduce((sum, vote) => sum + (parseFloat(vote.amount_usd) || 0), 0) || 0;

    // Get total users
    const { count: totalUsers } = await supabase
      .from('onedream_users')
      .select('*', { count: 'exact', head: true });

    const progressPercent = Math.min((totalVotes / GOAL_VOTES) * 100, 100);

    return {
      totalVotes,
      totalValueUSD: Math.round(totalValueUSD * 100) / 100, // Round to 2 decimal places
      totalUsers: totalUsers || 0,
      progressPercent: Math.round(progressPercent * 100) / 100,
      goalVotes: GOAL_VOTES
    };
  } catch (error) {
    console.error('Error getting global stats:', error);
    return {
      totalVotes: 0,
      totalValueUSD: 0,
      totalUsers: 0,
      progressPercent: 0,
      goalVotes: GOAL_VOTES
    };
  }
}

/**
 * Get user by referral token
 * @param {string} token - Referral token
 * @returns {Promise<Object|null>} - User object or null
 */
export async function getUserByReferralToken(token) {
  try {
    const { data, error } = await supabase
      .from('onedream_users')
      .select('*')
      .eq('referral_token', token)
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting user by referral token:', error);
    return null;
  }
}

/**
 * Record a vote for a user
 * @param {Object} voteData - Vote data
 * @param {string} voteData.userId - User ID
 * @param {number} voteData.votes - Number of votes
 * @param {number} voteData.amountUsd - Dollar amount (optional)
 * @param {string} voteData.source - Vote source ('payment', 'visit', 'referral')
 * @param {string} voteData.referrerId - Referrer user ID (optional)
 * @returns {Promise<Object>} - Created vote record
 */
export async function recordVote(voteData) {
  try {
    const { data, error } = await supabase
      .from('onedream_votes')
      .insert({
        user_id: voteData.userId,
        votes: voteData.votes || 1,
        amount_usd: voteData.amountUsd || 0,
        source: voteData.source,
        referrer_id: voteData.referrerId || null
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error recording vote:', error);
    throw error;
  }
}

/**
 * Simple rate limiting using in-memory storage
 * In production, replace with Redis or proper rate limiting service
 */
const rateLimitStore = new Map();

export function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, []);
  }
  
  const requests = rateLimitStore.get(key);
  
  // Remove old requests
  const validRequests = requests.filter(timestamp => timestamp > windowStart);
  
  if (validRequests.length >= maxRequests) {
    return false; // Rate limit exceeded
  }
  
  validRequests.push(now);
  rateLimitStore.set(key, validRequests);
  
  return true; // Request allowed
}

/**
 * Generate share URLs for social media
 * @param {string} referralUrl - The referral URL to share
 * @param {string} userName - Name of the user sharing
 * @returns {Object} - Object with social media URLs
 */
export function generateShareUrls(referralUrl, userName = '') {
  const text = `Help ${userName || 'me'} win the One Dream Initiative! Vote through my link:`;
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(referralUrl);
  
  return {
    twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    whatsapp: `https://api.whatsapp.com/send?text=${encodedText}%20${encodedUrl}`,
    email: `mailto:?subject=Vote for me in the One Dream Initiative&body=${text} ${referralUrl}`
  };
}