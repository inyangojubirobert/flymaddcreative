// ========================================
// ONE DREAM API + SUPABASE CLIENT
// Unified frontend client (safe global exports)
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
    async function registerParticipant(name, email, username, password, refCode) {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, username, password, ref_code: refCode || undefined })
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

        const token = data.user?.token || data.token;
        if (token) localStorage.setItem('onedream_token', token);
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
    // PARTICIPANT PROFILE API
    // ========================================

    // Public fetch — strips private contact if contact_is_public = false
    async function getParticipantProfile(username, isPublic = false) {
        const qs = isPublic ? '?public=true' : '';
        const res = await fetch(`${API_BASE_URL}/profile/${encodeURIComponent(username)}${qs}`);
        if (!res.ok) return null;
        return (await res.json()).profile || null;
    }

    // Authenticated save — upserts bio / media / contact in one call
    async function saveParticipantProfile(username, profileData, token) {
        const res = await fetch(`${API_BASE_URL}/profile/${encodeURIComponent(username)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(profileData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save profile');
        return data.profile;
    }

    // Authenticated media upload (video or image)
    async function uploadProfileMedia(file, token) {
        const formData = new FormData();
        formData.append('media', file);
        const res = await fetch(`${API_BASE_URL}/profile/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data; // { media_type, storage_path, public_url, bucket }
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

    // --- These are the names vote.js expects ---
    window.fetchParticipantByUsername = async function(username) {
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

    window.fetchParticipantByUserCode = async function(code) {
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
    // CATALOGUE API (direct Supabase)
    // ========================================
    async function getCatalogueByUsername(username) {
        const supabase = getSupabaseInstance();
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('catalogue_items')
            .select('*')
            .eq('seller_username', username)
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });
        if (error) { console.warn('Catalogue fetch error:', error); return []; }
        return data || [];
    }

    async function getPublicCatalogueByUsername(username) {
        const supabase = getSupabaseInstance();
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('catalogue_items')
            .select('*')
            .eq('seller_username', username)
            .eq('status', 'active')
            .order('created_at', { ascending: false });
        if (error) return [];
        return data || [];
    }

    async function getCatalogueItem(id) {
        const supabase = getSupabaseInstance();
        if (!supabase) return null;
        const { data, error } = await supabase
            .from('catalogue_items')
            .select('*')
            .eq('id', id)
            .single();
        if (error) return null;
        return data;
    }

    async function saveCatalogueItem(item) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');
        const payload = { ...item, updated_at: new Date().toISOString() };
        if (item.id) {
            const { data, error } = await supabase
                .from('catalogue_items')
                .update(payload)
                .eq('id', item.id)
                .eq('seller_username', item.seller_username)
                .select()
                .single();
            if (error) throw error;
            return data;
        } else {
            delete payload.id;
            const { data, error } = await supabase
                .from('catalogue_items')
                .insert({ ...payload, created_at: new Date().toISOString() })
                .select()
                .single();
            if (error) throw error;
            return data;
        }
    }

    async function deleteCatalogueItem(id, seller_username) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');
        const { error } = await supabase
            .from('catalogue_items')
            .update({ status: 'deleted' })
            .eq('id', id)
            .eq('seller_username', seller_username);
        if (error) throw error;
    }

    async function createCatalogueOrder(order) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');
        const buyerToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const { data, error } = await supabase
            .from('catalogue_orders')
            .insert({ ...order, buyer_token: buyerToken, created_at: new Date().toISOString() })
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async function getOrdersBySellerUsername(username) {
        const supabase = getSupabaseInstance();
        if (!supabase) return [];
        const { data, error } = await supabase
            .from('catalogue_orders')
            .select('*, catalogue_items(title)')
            .eq('seller_username', username)
            .order('created_at', { ascending: false });
        if (error) return [];
        return data || [];
    }

    async function getOrderById(orderId) {
        const supabase = getSupabaseInstance();
        if (!supabase) return null;
        const { data, error } = await supabase
            .from('catalogue_orders')
            .select('*, catalogue_items(title, images, price_usd, seller_username)')
            .eq('id', orderId)
            .single();
        if (error) return null;
        return data;
    }

    async function updateOrderStatus(orderId, status) {
        const supabase = getSupabaseInstance();
        if (!supabase) throw new Error('Supabase not initialized');
        const { data, error } = await supabase
            .from('catalogue_orders')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', orderId)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async function uploadCatalogueImage(file, token) {
        // Reuse the existing backend upload endpoint (avoids direct bucket access)
        const formData = new FormData();
        formData.append('media', file);
        const res = await fetch(`${API_BASE_URL}/profile/upload`, {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Image upload failed');
        return data.public_url;
    }

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
        fetchParticipantByUsername,
        fetchParticipantByUserCode,

        // Participant profile (bio, media, contact)
        getParticipantProfile,
        saveParticipantProfile,
        uploadProfileMedia,

        // Sales Catalogue
        getCatalogueByUsername,
        getPublicCatalogueByUsername,
        getCatalogueItem,
        saveCatalogueItem,
        deleteCatalogueItem,
        createCatalogueOrder,
        getOrdersBySellerUsername,
        getOrderById,
        updateOrderStatus,
        uploadCatalogueImage,
    };

    console.log('✅ One Dream API + Supabase Client loaded');
    console.log('📡 API Base URL:', API_BASE_URL);
})();
