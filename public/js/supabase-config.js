// ========================================
// ONE DREAM API + SUPABASE CLIENT
// Unified frontend client
// ========================================

(function () {
    'use strict';

    // ----------------------------------------
    // GLOBAL SAFE SUPABASE HOLDER (NO REDECLARE)
    // ----------------------------------------
    if (!window.__onedreamSupabase) {
        window.__onedreamSupabase = null;
    }

    function getSupabaseInstance() {
        return window.__onedreamSupabase;
    }

    // ----------------------------------------
    // API BASE URL
    // ----------------------------------------
    const API_BASE_URL =
        window.location.hostname === 'localhost'
            ? 'http://localhost:5001/api/onedream'
            : '/api/onedream';

    // ========================================
    // AUTH FUNCTIONS (BACKEND)
    // ========================================
    async function registerParticipant(name, email, username, password) {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Registration failed');
        return data.participant;
    }

    async function loginParticipant(email, password) {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');

        localStorage.setItem('onedream_token', data.token);
        localStorage.setItem('onedream_user', JSON.stringify(data.user));
        return data.user;
    }

    async function verifyToken() {
        const token = localStorage.getItem('onedream_token');
        if (!token) return null;

        const response = await fetch(`${API_BASE_URL}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            localStorage.clear();
            return null;
        }

        return response.json();
    }

    async function getCurrentUser() {
        const stored = localStorage.getItem('onedream_user');
        if (!stored) return null;

        const valid = await verifyToken();
        if (!valid) return null;

        return JSON.parse(stored);
    }

    function logout() {
        localStorage.clear();
    }

    function getAuthHeader() {
        const token = localStorage.getItem('onedream_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    // ========================================
    // PARTICIPANTS (BACKEND)
    // ========================================
    async function getParticipantByUsername(username) {
        const res = await fetch(`${API_BASE_URL}/participants/${username}`);
        if (!res.ok) return null;
        return (await res.json()).participant;
    }

    async function getParticipantByUserCode(code) {
        const res = await fetch(`${API_BASE_URL}/participants/code/${code}`);
        if (!res.ok) return null;
        return (await res.json()).participant;
    }

    async function getLeaderboard(limit = 50) {
        const res = await fetch(`${API_BASE_URL}/leaderboard?limit=${limit}`);
        if (!res.ok) return [];
        return (await res.json()).participants || [];
    }

    async function searchParticipants(query) {
        if (!query?.trim()) return [];
        const res = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return [];
        return (await res.json()).participants || [];
    }

    async function testConnection() {
        try {
            const res = await fetch(`${API_BASE_URL}/health`);
            return { success: res.ok, data: await res.json() };
        } catch (err) {
            return { success: false, error: err };
        }
    }

    // ========================================
    // SUPABASE INITIALIZATION (STATLESS + SAFE)
    // ========================================
    function initializeSupabase() {
        const meta = document.querySelector('meta[name="supabase-config"]');
        const url = meta?.getAttribute('data-url');
        const anon = meta?.getAttribute('data-anon');

        if (!url || !anon) {
            console.warn('⚠️ Supabase config missing - some features may be limited');
            return false;
        }

        if (!window.supabase) {
            console.error('❌ Supabase library not loaded. Add this to <head>:\n<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>');
            return false;
        }

        try {
            const options = {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false,
                    storage: undefined
                }
            };

            const client = typeof window.supabase.createClient === 'function'
                ? window.supabase.createClient(url, anon, options)
                : window.supabase(url, anon, options);

            window.__onedreamSupabase = client;
            window.supabaseClient = client;

            console.log('✅ Supabase initialized (stateless mode)');
            return true;
        } catch (err) {
            console.error('❌ Supabase init failed:', err);
            return false;
        }
    }

    // Initialize on load
    initializeSupabase();

    // ========================================
    // SUPABASE DIRECT QUERIES (FOR VOTE MODULES)
    // ========================================
    async function getParticipantsFromSupabase(limit = 50) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');

        const { data, error } = await supabase
            .from('participants')
            .select('id,name,username,user_code,total_votes,current_stage,created_at')
            .order('total_votes', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    }

    window.fetchParticipantByUsernameSupabase = async function(username) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');

        const { data, error } = await supabase
            .from('participants')
            .select('*')
            .eq('username', username)
            .single();

        if (error) throw error;
        return data;
    };

    window.fetchParticipantByUserCodeSupabase = async function(code) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');

        const { data, error } = await supabase
            .from('participants')
            .select('*')
            .eq('user_code', code)
            .single();

        if (error) throw error;
        return data;
    };

    // ========================================
    // EXPORT GLOBAL API
    // ========================================
    window.SupabaseAPI = {
        // Backend API
        registerParticipant,
        loginParticipant,
        verifyToken,
        getCurrentUser,
        logout,
        getAuthHeader,
        getParticipantByUsername,
        getParticipantByUserCode,
        getLeaderboard,
        searchParticipants,
        testConnection,

        // Direct Supabase access (for votes, leaderboard, progress)
        getParticipantsFromSupabase,
        getParticipantByUsername,
        getParticipantByUserCode
    };

    console.log('✅ One Dream API + Supabase Client loaded');
    console.log('📡 API Base URL:', API_BASE_URL);
})();
