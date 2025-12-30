// Supabase Configuration
const SUPABASE_URL = 'https://pjtuisyvpvoswmcgxsfs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdHVpc3l2cHZvc3dtY2d4c2ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1Mzg1MDUsImV4cCI6MjA3NzExNDUwNX0.Zj8WxKjj8d2tq2c5ATxN5RtvuIK5sLXPzM2ZC00vIzY';

// Initialize Supabase client
let supabaseClient = null;

function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    
    if (!window.supabase?.createClient) {
        throw new Error('Supabase JS library not loaded');
    }
    
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { 
            persistSession: true, 
            autoRefreshToken: true,
            detectSessionInUrl: false
        }
    });
    
    return supabaseClient;
}

// API Functions
async function registerParticipant(name, email, username) {
    const client = getSupabaseClient();
    
    // Check existing email
    const { data: existingEmail } = await client
        .from('participants')
        .select('id')
        .eq('email', email)
        .limit(1);
    
    if (existingEmail?.length > 0) {
        throw new Error('An account with this email already exists.');
    }
    
    // Check existing username
    const { data: existingUsername } = await client
        .from('participants')
        .select('id')
        .eq('username', username)
        .limit(1);
    
    if (existingUsername?.length > 0) {
        throw new Error('This username is already taken.');
    }
    
    // Insert participant
    const { data: participant, error } = await client
        .from('participants')
        .insert({ name, email, username })
        .select('id, name, email, username, user_code, total_votes, current_stage, created_at')
        .single();
    
    if (error) throw new Error(error.message);
    
    // Get referral link
    const { data: referralLink } = await client
        .from('referral_links')
        .select('user_vote_link')
        .eq('participant_id', participant.id)
        .single();
    
    return {
        ...participant,
        voteLink: referralLink?.user_vote_link || `https://www.flymaddcreative.online/vote.html?user=${username}`
    };
}

async function testConnection() {
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('participants')
        .select('id, username')
        .limit(3);
    
    return { success: !error, data, error };
}
