/**
 * Supabase API Client Configuration and Functions
 * Backend-only - used by API routes
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration - server-side only
const supabaseUrl = process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseKey) {
    console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY not set, using anon key');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// ===================================
// PARTICIPANTS API
// ===================================

/**
 * Get participant by email
 */
export async function getParticipantByEmail(email) {
    const { data, error } = await supabase
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
    const { data, error } = await supabase
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
    const { data, error } = await supabase
        .from('participants')
        .select('*')
        .eq('user_code', userCode.toUpperCase().trim())
        .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
}

/**
 * Create participant with password
 */
export async function createParticipant(name, email, username, passwordHash) {
    const { data, error } = await supabase
        .from('participants')
        .insert({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            username: username.toLowerCase().trim(),
            password_hash: passwordHash
        })
        .select('id, name, email, username, user_code, total_votes, current_stage, created_at')
        .single();
    
    if (error) throw error;
    return data;
}

/**
 * Get referral link for participant
 */
export async function getReferralLink(participantId) {
    const { data, error } = await supabase
        .from('referral_links')
        .select('user_vote_link')
        .eq('participant_id', participantId)
        .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data?.user_vote_link || null;
}

/**
 * Get leaderboard
 */
export async function getLeaderboard(limit = 50) {
    const { data, error } = await supabase
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
    const searchTerm = query.trim();
    if (!searchTerm) return [];
    
    const { data, error } = await supabase
        .from('participants')
        .select('id, name, username, user_code, total_votes, current_stage')
        .or(`username.ilike.%${searchTerm}%,user_code.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%`)
        .order('total_votes', { ascending: false })
        .limit(20);
    
    if (error) throw error;
    return data || [];
}

/**
 * Verify participant password
 */
export async function getParticipantWithPassword(email) {
    const { data, error } = await supabase
        .from('participants')
        .select('id, name, email, username, user_code, password_hash, total_votes, current_stage, created_at')
        .eq('email', email.toLowerCase().trim())
        .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
}

export default supabase;