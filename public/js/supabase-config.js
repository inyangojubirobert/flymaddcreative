// // ========================================
// // ONE DREAM API CLIENT
// // Backend-first architecture (Supabase is READ-ONLY on frontend)
// // ========================================

// const API_BASE_URL =
//     window.location.hostname === 'localhost'
//         ? 'http://localhost:5001/api/onedream'
//         : '/api/onedream';

// // ========================================
// // AUTH FUNCTIONS (Participants ONLY)
// // ========================================

// async function registerParticipant(name, email, username, password) {
//     const response = await fetch(`${API_BASE_URL}/register`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ name, email, username, password })
//     });

//     const data = await response.json();
//     if (!response.ok) throw new Error(data.error || 'Registration failed');
//     return data.participant;
// }

// async function loginParticipant(email, password) {
//     const response = await fetch(`${API_BASE_URL}/login`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ email, password })
//     });

//     const data = await response.json();
//     if (!response.ok) throw new Error(data.error || 'Login failed');
//     return data.user;
// }

// async function verifyToken() {
//     const token = localStorage.getItem('onedream_token');
//     if (!token) return null;

//     try {
//         const response = await fetch(`${API_BASE_URL}/verify`, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//                 Authorization: `Bearer ${token}`
//             }
//         });

//         if (!response.ok) {
//             localStorage.removeItem('onedream_token');
//             localStorage.removeItem('onedream_user');
//             return null;
//         }

//         return await response.json();
//     } catch {
//         return null;
//     }
// }

// async function getCurrentUser() {
//     const token = localStorage.getItem('onedream_token');
//     const savedUser = localStorage.getItem('onedream_user');
//     if (!token || !savedUser) return null;

//     try {
//         const verified = await verifyToken();
//         if (!verified) return null;
//         return JSON.parse(savedUser);
//     } catch {
//         return null;
//     }
// }

// function logout() {
//     localStorage.removeItem('onedream_token');
//     localStorage.removeItem('onedream_user');
// }

// // ========================================
// // PARTICIPANTS (Public / Read-only)
// // ========================================

// async function getParticipantByUsername(username) {
//     try {
//         const res = await fetch(`${API_BASE_URL}/participants/${username}`);
//         if (!res.ok) return null;
//         return (await res.json()).participant;
//     } catch {
//         return null;
//     }
// }

// async function getParticipantByUserCode(code) {
//     try {
//         const res = await fetch(`${API_BASE_URL}/participants/code/${code}`);
//         if (!res.ok) return null;
//         return (await res.json()).participant;
//     } catch {
//         return null;
//     }
// }

// async function getLeaderboard(limit = 50) {
//     try {
//         const res = await fetch(`${API_BASE_URL}/leaderboard?limit=${limit}`);
//         if (!res.ok) throw new Error();
//         return (await res.json()).participants || [];
//     } catch {
//         return [];
//     }
// }

// async function searchParticipants(query) {
//     if (!query?.trim()) return [];
//     try {
//         const res = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
//         if (!res.ok) throw new Error();
//         return (await res.json()).participants || [];
//     } catch {
//         return [];
//     }
// }

// async function testConnection() {
//     try {
//         const res = await fetch(`${API_BASE_URL}/health`);
//         return { success: res.ok, data: await res.json() };
//     } catch (err) {
//         return { success: false, error: err };
//     }
// }

// function getAuthHeader() {
//     const token = localStorage.getItem('onedream_token');
//     return token ? { Authorization: `Bearer ${token}` } : {};
// }

// // ========================================
// // SUPABASE (READ-ONLY, PUBLIC DATA)
// // ========================================

// let supabase = null;

// /**
//  * Wait until Supabase CDN is available (prevents race conditions)
//  */
// function waitForSupabase(timeout = 3000) {
//     return new Promise((resolve, reject) => {
//         const start = Date.now();
//         const timer = setInterval(() => {
//             if (window.supabase?.createClient || typeof window.supabase === 'function') {
//                 clearInterval(timer);
//                 resolve(true);
//             }
//             if (Date.now() - start > timeout) {
//                 clearInterval(timer);
//                 reject(new Error('Supabase CDN not loaded'));
//             }
//         }, 50);
//     });
// }

// /**
//  * Initialize Supabase safely (v2 + v1)
//  */
// window.initSupabaseFromMeta = async function () {
//     if (supabase) return true;

//     const meta = document.querySelector('meta[name="supabase-config"]');
//     const url = meta?.getAttribute('data-url');
//     const anon = meta?.getAttribute('data-anon');

//     if (!url || !anon) {
//         console.warn('⚠️ Supabase meta config missing');
//         return false;
//     }

//     try {
//         await waitForSupabase();

//         // v2 (current)
//         if (window.supabase?.createClient) {
//             supabase = window.supabase.createClient(url, anon);
//             console.log('✅ Supabase v2 initialized');
//             return true;
//         }

//         // v1 (legacy)
//         if (typeof window.supabase === 'function') {
//             supabase = window.supabase(url, anon);
//             console.log('⚠️ Supabase v1 initialized');
//             return true;
//         }

//         return false;
//     } catch (err) {
//         console.warn('⚠️ Supabase init skipped:', err.message);
//         return false;
//     }
// };

// window.fetchParticipantByUsername = async function (username) {
//     if (!supabase) throw new Error('Supabase not initialized');
//     const { data, error } = await supabase
//         .from('participants')
//         .select('id, name, username, email, user_code, total_votes, created_at')
//         .eq('username', username)
//         .single();
//     if (error) throw error;
//     return data;
// };

// window.fetchParticipantByUserCode = async function (code) {
//     if (!supabase) throw new Error('Supabase not initialized');
//     const { data, error } = await supabase
//         .from('participants')
//         .select('id, name, username, email, user_code, total_votes, created_at')
//         .eq('user_code', code)
//         .single();
//     if (error) throw error;
//     return data;
// };

// // ========================================
// // EXPORT GLOBAL API
// // ========================================

// window.SupabaseAPI = {
//     registerParticipant,
//     loginParticipant,
//     verifyToken,
//     getCurrentUser,
//     logout,
//     getAuthHeader,
//     getParticipantByUsername,
//     getParticipantByUserCode,
//     getLeaderboard,
//     searchParticipants,
//     testConnection
// };

// console.log('✅ One Dream API Client loaded');
// console.log('📡 API Base URL:', API_BASE_URL);
// ========================================
// ONE DREAM API CLIENT
// Calls backend API instead of direct Supabase
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

    function setSupabaseInstance(client) {
        window.__onedreamSupabase = client;
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
    // SUPABASE INITIALIZATION (SAFE)
    // ========================================

    window.initSupabaseFromMeta = function () {
        // Always try to read from meta tag (required for your setup)
        const meta = document.querySelector('meta[name="supabase-config"]');
        const url = meta?.getAttribute('data-url');
        const anon = meta?.getAttribute('data-anon');

        if (!url || !anon) {
            console.error('❌ Supabase meta config missing. Make sure your <meta name="supabase-config" ...> tag is present in the <head> of your HTML.');
            return false;
        }

        if (!window.supabase) {
            console.error(
                '❌ Supabase UMD not loaded. Make sure this comes BEFORE supabase-config.js:\n' +
                '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>'
            );
            return false;
        }

        try {
            const client =
                typeof window.supabase.createClient === 'function'
                    ? window.supabase.createClient(url, anon)
                    : window.supabase(url, anon);

            window.__onedreamSupabase = client;
            console.log('✅ Supabase initialized');
            return true;
        } catch (err) {
            console.error('❌ Supabase init failed:', err);
            return false;
        }
    };

    // Supabase Configuration and Client Initialization

    // Get Supabase credentials from meta tag
    const supabaseConfigMeta = document.querySelector('meta[name="supabase-config"]');
    const SUPABASE_URL = supabaseConfigMeta?.getAttribute('data-url');
    const SUPABASE_ANON_KEY = supabaseConfigMeta?.getAttribute('data-anon');

    // Initialize Supabase client (using CDN global)
    let supabaseClient;

    try {
        if (!window.supabase) {
            throw new Error('Supabase library not loaded');
        }
        
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error('Supabase configuration missing');
        }
        
        // Use the global supabase object from CDN
        const { createClient } = window.supabase;
        supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        
        console.log('✅ Supabase initialized successfully');
    } catch (error) {
        console.error('❌ Supabase initialization failed:', error);
    }

    // Export for use in other scripts
    window.supabaseClient = supabaseClient;

    // ========================================
    // SUPABASE DIRECT QUERIES
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

    window.fetchParticipantByUsername = async function (username) {
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

    window.fetchParticipantByUserCode = async function (code) {
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
        getParticipantsFromSupabase,
        testConnection
    };

    console.log('✅ One Dream API Client loaded');
    console.log('📡 API Base URL:', API_BASE_URL);
})();
