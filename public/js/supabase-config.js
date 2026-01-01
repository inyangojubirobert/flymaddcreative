// ========================================
// ONE DREAM API CLIENT
// Backend-first architecture (Supabase is READ-ONLY on frontend)
// ========================================

const API_BASE_URL =
    window.location.hostname === 'localhost'
        ? 'http://localhost:5001/api/onedream'
        : '/api/onedream';

// ========================================
// AUTH FUNCTIONS (Participants ONLY)
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
    return data.user;
}

async function verifyToken() {
    const token = localStorage.getItem('onedream_token');
    if (!token) return null;

    try {
        const response = await fetch(`${API_BASE_URL}/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        });

        if (!response.ok) {
            localStorage.removeItem('onedream_token');
            localStorage.removeItem('onedream_user');
            return null;
        }

        return await response.json();
    } catch {
        return null;
    }
}

async function getCurrentUser() {
    const token = localStorage.getItem('onedream_token');
    const savedUser = localStorage.getItem('onedream_user');
    if (!token || !savedUser) return null;

    try {
        const verified = await verifyToken();
        if (!verified) return null;
        return JSON.parse(savedUser);
    } catch {
        return null;
    }
}

function logout() {
    localStorage.removeItem('onedream_token');
    localStorage.removeItem('onedream_user');
}

// ========================================
// PARTICIPANTS (Public / Read-only)
// ========================================

async function getParticipantByUsername(username) {
    try {
        const res = await fetch(`${API_BASE_URL}/participants/${username}`);
        if (!res.ok) return null;
        return (await res.json()).participant;
    } catch {
        return null;
    }
}

async function getParticipantByUserCode(code) {
    try {
        const res = await fetch(`${API_BASE_URL}/participants/code/${code}`);
        if (!res.ok) return null;
        return (await res.json()).participant;
    } catch {
        return null;
    }
}

async function getLeaderboard(limit = 50) {
    try {
        const res = await fetch(`${API_BASE_URL}/leaderboard?limit=${limit}`);
        if (!res.ok) throw new Error();
        return (await res.json()).participants || [];
    } catch {
        return [];
    }
}

async function searchParticipants(query) {
    if (!query?.trim()) return [];
    try {
        const res = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error();
        return (await res.json()).participants || [];
    } catch {
        return [];
    }
}

async function testConnection() {
    try {
        const res = await fetch(`${API_BASE_URL}/health`);
        return { success: res.ok, data: await res.json() };
    } catch (err) {
        return { success: false, error: err };
    }
}

function getAuthHeader() {
    const token = localStorage.getItem('onedream_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ========================================
// SUPABASE (READ-ONLY, PUBLIC DATA)
// ========================================

let supabase = null;

/**
 * Wait until Supabase CDN is available (prevents race conditions)
 */
function waitForSupabase(timeout = 3000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
            if (window.supabase?.createClient || typeof window.supabase === 'function') {
                clearInterval(timer);
                resolve(true);
            }
            if (Date.now() - start > timeout) {
                clearInterval(timer);
                reject(new Error('Supabase CDN not loaded'));
            }
        }, 50);
    });
}

/**
 * Initialize Supabase safely (v2 + v1)
 */
window.initSupabaseFromMeta = async function () {
    if (supabase) return true;

    const meta = document.querySelector('meta[name="supabase-config"]');
    const url = meta?.getAttribute('data-url');
    const anon = meta?.getAttribute('data-anon');

    if (!url || !anon) {
        console.warn('⚠️ Supabase meta config missing');
        return false;
    }

    try {
        await waitForSupabase();

        // v2 (current)
        if (window.supabase?.createClient) {
            supabase = window.supabase.createClient(url, anon);
            console.log('✅ Supabase v2 initialized');
            return true;
        }

        // v1 (legacy)
        if (typeof window.supabase === 'function') {
            supabase = window.supabase(url, anon);
            console.log('⚠️ Supabase v1 initialized');
            return true;
        }

        return false;
    } catch (err) {
        console.warn('⚠️ Supabase init skipped:', err.message);
        return false;
    }
};

window.fetchParticipantByUsername = async function (username) {
    if (!supabase) throw new Error('Supabase not initialized');
    const { data, error } = await supabase
        .from('participants')
        .select('id, name, username, email, user_code, total_votes, created_at')
        .eq('username', username)
        .single();
    if (error) throw error;
    return data;
};

window.fetchParticipantByUserCode = async function (code) {
    if (!supabase) throw new Error('Supabase not initialized');
    const { data, error } = await supabase
        .from('participants')
        .select('id, name, username, email, user_code, total_votes, created_at')
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
    testConnection
};

console.log('✅ One Dream API Client loaded');
console.log('📡 API Base URL:', API_BASE_URL);
