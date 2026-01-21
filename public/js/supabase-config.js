/**
 * ONE DREAM INITIATIVE - UNIFIED CLIENT SDK (PRO)
 * Integrates: Backend API, Direct Supabase Queries, and Auto-Retry Logic.
 */

(function () {
    'use strict';

    // ----------------------------------------
    // GLOBAL STATE & CONSTANTS
    // ----------------------------------------
    if (!window.__onedreamSupabase) {
        window.__onedreamSupabase = null;
    }

    const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5001/api/onedream'
        : '/api/onedream';

    function getSupabaseInstance() {
        return window.__onedreamSupabase;
    }

    // ----------------------------------------
    // INITIALIZATION LOGIC (WITH RETRY)
    // ----------------------------------------
    async function initializeSupabase(retryCount = 0) {
        const meta = document.querySelector('meta[name="supabase-config"]');
        const url = meta?.getAttribute('data-url');
        const anon = meta?.getAttribute('data-anon');

        if (!url || !anon) {
            console.warn('⚠️ Supabase config meta tags missing.');
            return false;
        }

        // Check if library is available (Race Condition Protection)
        if (!window.supabase) {
            if (retryCount < 20) { // Try for 2 seconds total
                setTimeout(() => initializeSupabase(retryCount + 1), 100);
                return;
            }
            console.error('❌ Supabase library failed to load after 20 attempts.');
            return false;
        }

        try {
            const options = {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storage: window.localStorage
                }
            };

            const client = typeof window.supabase.createClient === 'function'
                ? window.supabase.createClient(url, anon, options)
                : window.supabase(url, anon, options);

            window.__onedreamSupabase = client;
            window.supabaseClient = client;

            console.log('✅ Supabase initialized successfully (Order Restored)');
            
            // Dispatch event so other scripts (vote.js) know it's safe to query
            window.dispatchEvent(new CustomEvent('SupabaseReady', { detail: { client } }));
            return true;
        } catch (err) {
            console.error('❌ Supabase init failed:', err);
            return false;
        }
    }

    // ----------------------------------------
    // AUTH FUNCTIONS (BACKEND)
    // ----------------------------------------
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
        window.location.href = 'index.html';
    }

    function getAuthHeader() {
        const token = localStorage.getItem('onedream_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    // ----------------------------------------
    // PARTICIPANT & LEADERBOARD (MIXED MODES)
    // ----------------------------------------
    async function getParticipantByUsername(username) {
        const res = await fetch(`${API_BASE_URL}/participants/${username}`);
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

    // ----------------------------------------
    // DIRECT SUPABASE QUERIES (FOR VOTE MODULES)
    // ----------------------------------------
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

    // Global wrappers expected by vote.js
    window.fetchParticipantByUsername = async function(username) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase connection pending...');
        const { data, error } = await supabase
            .from('participants')
            .select('*')
            .eq('username', username)
            .single();
        if (error) throw error;
        return data;
    };

    window.fetchParticipantByUserCode = async function(code) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase connection pending...');
        const { data, error } = await supabase
            .from('participants')
            .select('*')
            .eq('user_code', code)
            .single();
        if (error) throw error;
        return data;
    };

    // ----------------------------------------
    // EXPORT GLOBAL API
    // ----------------------------------------
    window.SupabaseAPI = {
        registerParticipant,
        loginParticipant,
        verifyToken,
        getCurrentUser,
        logout,
        getAuthHeader,
        getParticipantByUsername,
        getLeaderboard,
        searchParticipants,
        getParticipantsFromSupabase,
        fetchParticipantByUsername: window.fetchParticipantByUsername,
        fetchParticipantByUserCode: window.fetchParticipantByUserCode,
        testConnection: async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/health`);
                return { success: res.ok, data: await res.json() };
            } catch (err) { return { success: false, error: err }; }
        }
    };

    // Auto-run initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initializeSupabase());
    } else {
        initializeSupabase();
    }

    console.log('🚀 One Dream Unified Client Loaded (Base URL:', API_BASE_URL, ')');
})();