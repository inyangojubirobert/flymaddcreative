/**
 * Supabase API Client Configuration and Functions
 * Handles all database operations for the One Dream Initiative
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ===================================
// PARTICIPANTS API
// ===================================

/**
 * Get leaderboard data with sorting options
 */
export async function getLeaderboard(sortBy = 'allTime', limit = 10) {
  try {
    let query = supabase
      .from('leaderboard')
      .select('*')
      .limit(limit);

    // Apply sorting
    switch (sortBy) {
      case 'thisRound':
        query = query.order('round_votes', { ascending: false });
        break;
      case 'country':
        query = query.order('country', { ascending: true });
        break;
      default: // allTime
        query = query.order('total_votes', { ascending: false });
    }

    const { data, error } = await query;
    
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get global campaign statistics
 */
export async function getGlobalStats() {
  try {
    const { data, error } = await supabase
      .from('global_stats')
      .select('*')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching global stats:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user statistics and achievements
 */
export async function getUserStats(participantId) {
  try {
    const { data, error } = await supabase
      .from('user_stats')
      .select('*')
      .eq('id', participantId)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new participant
 */
export async function createParticipant(participantData) {
  try {
    // Generate unique referral code
    const referralCode = generateReferralCode(participantData.name);
    
    const { data, error } = await supabase
      .from('participants')
      .insert({
        ...participantData,
        referral_code: referralCode
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error creating participant:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update participant information
 */
export async function updateParticipant(participantId, updates) {
  try {
    const { data, error } = await supabase
      .from('participants')
      .update(updates)
      .eq('id', participantId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error updating participant:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Find participant by referral code
 */
export async function getParticipantByRefCode(refCode) {
  try {
    const { data, error } = await supabase
      .from('participants')
      .select('*')
      .eq('referral_code', refCode)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error finding participant by ref code:', error);
    return { success: false, error: error.message };
  }
}

// ===================================
// VOTES API
// ===================================

/**
 * Record a new vote
 */
export async function recordVote(voteData) {
  try {
    const { data, error } = await supabase
      .from('votes')
      .insert(voteData)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error recording vote:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if IP has voted recently for specific referral
 */
export async function checkRecentVote(ipAddress, referralCode, hoursAgo = 24) {
  try {
    const timeThreshold = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    
    const { data, error } = await supabase
      .from('votes')
      .select('id')
      .eq('ip_address', ipAddress)
      .eq('referral_code', referralCode)
      .gte('created_at', timeThreshold)
      .limit(1);

    if (error) throw error;
    return { success: true, hasVoted: data && data.length > 0 };
  } catch (error) {
    console.error('Error checking recent vote:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get vote history for a participant
 */
export async function getVoteHistory(participantId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from('votes')
      .select('*')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching vote history:', error);
    return { success: false, error: error.message };
  }
}

// ===================================
// ANALYTICS API
// ===================================

/**
 * Track analytics event
 */
export async function trackEvent(eventName, eventData, participantId = null) {
  try {
    const { data, error } = await supabase
      .from('analytics_events')
      .insert({
        event_name: eventName,
        event_data: eventData,
        participant_id: participantId
      });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error tracking event:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get analytics data for dashboard
 */
export async function getAnalytics(startDate, endDate, eventName = null) {
  try {
    let query = supabase
      .from('analytics_events')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (eventName) {
      query = query.eq('event_name', eventName);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return { success: false, error: error.message };
  }
}

// ===================================
// MILESTONES API
// ===================================

/**
 * Get all milestones
 */
export async function getMilestones() {
  try {
    const { data, error } = await supabase
      .from('milestones')
      .select('*')
      .eq('is_active', true)
      .order('vote_threshold', { ascending: true });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching milestones:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user achievements
 */
export async function getUserAchievements(participantId) {
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select(`
        *,
        milestones (
          name,
          badge_emoji,
          reward_amount,
          description
        )
      `)
      .eq('participant_id', participantId)
      .order('achieved_at', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching user achievements:', error);
    return { success: false, error: error.message };
  }
}

// ===================================
// REAL-TIME SUBSCRIPTIONS
// ===================================

/**
 * Subscribe to leaderboard changes
 */
export function subscribeToLeaderboard(callback) {
  return supabase
    .channel('leaderboard-changes')
    .on('postgres_changes', 
      { 
        event: '*', 
        schema: 'public', 
        table: 'participants' 
      }, 
      callback
    )
    .subscribe();
}

/**
 * Subscribe to global stats changes
 */
export function subscribeToGlobalStats(callback) {
  return supabase
    .channel('global-stats-changes')
    .on('postgres_changes', 
      { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'global_stats' 
      }, 
      callback
    )
    .subscribe();
}

/**
 * Subscribe to user-specific changes
 */
export function subscribeToUserChanges(participantId, callback) {
  return supabase
    .channel(`user-changes-${participantId}`)
    .on('postgres_changes', 
      { 
        event: '*', 
        schema: 'public', 
        table: 'votes',
        filter: `participant_id=eq.${participantId}`
      }, 
      callback
    )
    .subscribe();
}

// ===================================
// HELPER FUNCTIONS
// ===================================

/**
 * Generate unique referral code
 */
function generateReferralCode(name) {
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${cleanName.substring(0, 6)}${randomSuffix}`;
}

/**
 * Get user's IP address
 */
export async function getUserIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.warn('Could not get user IP:', error);
    return 'unknown';
  }
}

/**
 * Format currency
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

/**
 * Format number with commas
 */
export function formatNumber(number) {
  return new Intl.NumberFormat('en-US').format(number);
}

/**
 * Calculate time ago
 */
export function timeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - new Date(date)) / 1000);

  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(diffInSeconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
    }
  }

  return 'Just now';
}

// Export default client for direct use
export default supabase;