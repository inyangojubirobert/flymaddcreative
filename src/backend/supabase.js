/**
 * Supabase API Client Configuration and Functions
 * Backend-only - used by API routes
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

// --------------------
// Supabase Configuration (Lazy Initialization)
// --------------------
let _supabase = null;

function getSupabaseClient() {
  if (!_supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }
    
    _supabase = createClient(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

// Helper to get the client in each function
const getDb = getSupabaseClient;

// --------------------
// PARTICIPANTS API
// --------------------

/**
 * Get participant by email
 */
export async function getParticipantByEmail(email) {
  const db = getDb();
  const { data, error } = await db
    .from('participants')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

/**
 * Get participant by username
 */
export async function getParticipantByUsername(username) {
  const db = getDb();
  const { data, error } = await db
    .from('participants')
    .select('*')
    .eq('username', username.toLowerCase().trim())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Get participant by user_code
 */
export async function getParticipantByUserCode(userCode) {
  const db = getDb();
  const { data, error } = await db
    .from('participants')
    .select('*')
    .eq('user_code', userCode.toUpperCase().trim())
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Register participant (hashes password before saving)
 */
export async function registerParticipant(name, email, username, password) {
  const db = getDb();
  // Check if email or username already exists
  const existingEmail = await getParticipantByEmail(email);
  if (existingEmail) throw new Error('Email already registered');

  const existingUsername = await getParticipantByUsername(username);
  if (existingUsername) throw new Error('Username already taken');

  // Hash the password
  const passwordHash = bcrypt.hashSync(password, 10);

  // Insert participant
  const { data, error } = await db
    .from('participants')
    .insert({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      username: username.toLowerCase().trim(),
      password_hash: passwordHash
    })
    .select('id, name, email, username, user_code, total_votes, current_stage, created_at')
    .single();

  if (error) {
    console.error('SUPABASE INSERT ERROR:', error);
    throw new Error(error.message);
  }

  return data;
}

/**
 * Verify participant password
 */
export async function verifyParticipantPassword(email, password) {
  const db = getDb();
  const participant = await db
    .from('participants')
    .select('id, name, email, username, user_code, password_hash, total_votes, current_stage, created_at')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!participant.data) return null;

  const isValid = bcrypt.compareSync(password, participant.data.password_hash);
  if (!isValid) return null;

  // Remove password_hash before returning
  const { password_hash, ...safeData } = participant.data;
  return safeData;
}

/**
 * Get referral link for participant
 */
export async function getReferralLink(participantId) {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('referral_links')
      .select('user_vote_link')
      .eq('participant_id', participantId)
      .single();

    if (error) {
      // Table might not exist or no record found - return null instead of throwing
      console.warn('getReferralLink warning:', error.message);
      return null;
    }
    return data?.user_vote_link || null;
  } catch (err) {
    console.warn('getReferralLink error:', err.message);
    return null;
  }
}

/**
 * Get leaderboard
 */
export async function getLeaderboard(limit = 50) {
  const db = getDb();
  const { data, error } = await db
    .from('participants')
    .select('id, name, username, user_code, total_votes, total_amount, current_stage, created_at')
    .order('total_votes', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Search participants
 */
export async function searchParticipants(query) {
  const db = getDb();
  const searchTerm = query.trim();
  if (!searchTerm) return [];

  const { data, error } = await db
    .from('participants')
    .select('id, name, username, user_code, total_votes, current_stage')
    .or(`username.ilike.%${searchTerm}%,user_code.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`)
    .order('total_votes', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

/**
 * Get participant with password (for internal use)
 */
export async function getParticipantWithPassword(email) {
  const db = getDb();
  const { data, error } = await db
    .from('participants')
    .select('id, name, email, username, user_code, password_hash, total_votes, current_stage, created_at')
    .eq('email', email.toLowerCase().trim())
    .single();

  // PGRST116 = no rows returned, which is not an error for login
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// Make sure you export createParticipant if you want to use it in register-participant.js
// If you meant registerParticipant, export it as createParticipant for compatibility:

export { registerParticipant as createParticipant };
