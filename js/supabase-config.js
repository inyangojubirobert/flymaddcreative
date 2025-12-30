// ========================================
// ONE DREAM API CLIENT
// Calls backend API instead of direct Supabase
// ========================================

const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:5001/api/onedream'
    : '/api/onedream';

// ========================================
// AUTH FUNCTIONS
// ========================================

/**
 * Register a new participant
 */
async function registerParticipant(name, email, username, password) {
    console.log('🔍 registerParticipant called:', { name, email, username, password: '***' });
    
    const response = await fetch(`${API_BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, username, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
    }
    
    console.log('✅ Registration successful:', data);
    return data.participant;
}

/**
 * Login with email and password
 */
async function loginParticipant(email, password) {
    console.log('🔍 loginParticipant called:', { email, password: '***' });
    
    const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error || 'Login failed');
    }
    
    console.log('✅ Login successful');
    return data.user;
}

/**
 * Verify session token
 */
async function verifyToken() {
    const token = localStorage.getItem('onedream_token');
    if (!token) return null;
    
    try {
        const response = await fetch(`${API_BASE_URL}/verify`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
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

/**
 * Get current logged-in user
 */
async function getCurrentUser() {
    const token = localStorage.getItem('onedream_token');
    if (!token) return null;
    
    const savedUser = localStorage.getItem('onedream_user');
    if (!savedUser) return null;
    
    try {
        const user = JSON.parse(savedUser);
        // Optionally verify token is still valid
        const verified = await verifyToken();
        if (!verified) return null;
        
        // Fetch fresh user data
        return await getParticipantByUsername(user.username);
    } catch {
        return null;
    }
}

/**
 * Logout
 */
function logout() {
    localStorage.removeItem('onedream_token');
    localStorage.removeItem('onedream_user');
}

// ========================================
// PARTICIPANT FUNCTIONS
// ========================================

/**
 * Get participant by username
 */
async function getParticipantByUsername(username) {
    try {
        const response = await fetch(`${API_BASE_URL}/participants/${username}`);
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.participant;
    } catch {
        return null;
    }
}

/**
 * Get participant by user_code
 */
async function getParticipantByUserCode(userCode) {
    try {
        const response = await fetch(`${API_BASE_URL}/participants/code/${userCode}`);
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.participant;
    } catch {
        return null;
    }
}

/**
 * Get leaderboard
 */
async function getLeaderboard(limit = 50) {
    try {
        const response = await fetch(`${API_BASE_URL}/leaderboard?limit=${limit}`);
        
        if (!response.ok) throw new Error('Failed to fetch leaderboard');
        
        const data = await response.json();
        return data.participants || [];
    } catch (err) {
        console.error('Leaderboard error:', err);
        return [];
    }
}

/**
 * Search participants
 */
async function searchParticipants(query) {
    if (!query?.trim()) return [];
    
    try {
        const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
        
        if (!response.ok) throw new Error('Search failed');
        
        const data = await response.json();
        return data.participants || [];
    } catch (err) {
        console.error('Search error:', err);
        return [];
    }
}

/**
 * Test API connection
 */
async function testConnection() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();
        return { success: response.ok, data, error: null };
    } catch (err) {
        return { success: false, data: null, error: err };
    }
}

/**
 * Get auth header for authenticated requests
 */
function getAuthHeader() {
    const token = localStorage.getItem('onedream_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// ========================================
// EXPORT FOR GLOBAL ACCESS
// ========================================
window.SupabaseAPI = {
    // Auth
    registerParticipant,
    loginParticipant,
    verifyToken,
    getCurrentUser,
    logout,
    getAuthHeader,
    
    // Participants
    getParticipantByUsername,
    getParticipantByUserCode,
    getLeaderboard,
    searchParticipants,
    
    // Utils
    testConnection
};

console.log('✅ One Dream API Client loaded');
console.log('📡 API Base URL:', API_BASE_URL);