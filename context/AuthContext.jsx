import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// Token storage keys
const TOKEN_KEY = 'onedream_token';
const USER_KEY = 'onedream_user';

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Initialize auth state from localStorage on mount
    useEffect(() => {
        initializeAuth();
    }, []);

    const initializeAuth = () => {
        try {
            const storedToken = localStorage.getItem(TOKEN_KEY);
            const storedUser = localStorage.getItem(USER_KEY);

            if (storedToken && storedUser) {
                setToken(storedToken);
                setUser(JSON.parse(storedUser));
                
                // Optionally verify token is still valid
                verifyToken(storedToken);
            }
        } catch (err) {
            console.error('Auth initialization error:', err);
            clearAuth();
        } finally {
            setLoading(false);
        }
    };

    // Verify token with backend
    const verifyToken = async (authToken) => {
        try {
            const response = await fetch('/api/onedream/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                // Token is invalid, clear auth
                clearAuth();
            }
        } catch (err) {
            console.error('Token verification error:', err);
            // Don't clear auth on network errors
        }
    };

    // Login function
    const login = async (email, password) => {
        setError(null);
        setLoading(true);

        try {
            const response = await fetch('/api/onedream/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            // Save to state and localStorage
            setToken(data.token);
            setUser(data.user);
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(USER_KEY, JSON.stringify(data.user));

            return { success: true, user: data.user };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    // Register function
    const register = async (name, email, password, bio = '') => {
        setError(null);
        setLoading(true);

        try {
            const response = await fetch('/api/onedream/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, bio })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            // Auto-login after registration
            setToken(data.token);
            setUser(data.user);
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(USER_KEY, JSON.stringify(data.user));

            return { success: true, user: data.user };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    // Logout function
    const logout = () => {
        clearAuth();
    };

    // Clear auth state
    const clearAuth = () => {
        setToken(null);
        setUser(null);
        setError(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    };

    // Update user profile
    const updateProfile = async (updates) => {
        if (!token) return { success: false, error: 'Not authenticated' };

        try {
            const response = await fetch('/api/onedream/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updates)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Update failed');
            }

            // Update local state
            const updatedUser = { ...user, ...data.user };
            setUser(updatedUser);
            localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));

            return { success: true, user: updatedUser };
        } catch (err) {
            return { success: false, error: err.message };
        }
    };

    // Get auth header for API requests
    const getAuthHeader = () => {
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    };

    const value = {
        user,
        token,
        loading,
        error,
        isAuthenticated: !!token && !!user,
        login,
        register,
        logout,
        updateProfile,
        getAuthHeader,
        clearError: () => setError(null)
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// Custom hook to use auth context
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

// HOC for protected routes
export function withAuth(Component) {
    return function ProtectedRoute(props) {
        const { isAuthenticated, loading } = useAuth();
        const router = typeof window !== 'undefined' ? require('next/router').useRouter() : null;

        useEffect(() => {
            if (!loading && !isAuthenticated && router) {
                router.push('/onedream/login');
            }
        }, [isAuthenticated, loading, router]);

        if (loading) {
            return (
                <div className="min-h-screen flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
            );
        }

        if (!isAuthenticated) {
            return null;
        }

        return <Component {...props} />;
    };
}

export default AuthContext;
