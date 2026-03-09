// context/MerchantAuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';

const MerchantAuthContext = createContext(null);

const TOKEN_KEY = 'merchant_token';
const MERCHANT_KEY = 'merchant_data';

export function MerchantAuthProvider({ children }) {
    const [merchant, setMerchant] = useState(null);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        initializeAuth();
    }, []);

    const initializeAuth = () => {
        try {
            const storedToken = localStorage.getItem(TOKEN_KEY);
            const storedMerchant = localStorage.getItem(MERCHANT_KEY);

            if (storedToken && storedMerchant) {
                setToken(storedToken);
                setMerchant(JSON.parse(storedMerchant));
            }
        } catch (err) {
            console.error('Merchant auth initialization error:', err);
            clearAuth();
        } finally {
            setLoading(false);
        }
    };

    const login = async (email, password) => {
        setError(null);
        setLoading(true);

        try {
            const response = await fetch('/api/merchants/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }

            setToken(data.token);
            setMerchant(data.merchant);
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(MERCHANT_KEY, JSON.stringify(data.merchant));

            return { success: true, merchant: data.merchant };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    const register = async (merchantData) => {
        setError(null);
        setLoading(true);

        try {
            const response = await fetch('/api/merchants/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(merchantData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Registration failed');
            }

            return { 
                success: true, 
                merchant: data.merchant,
                referral_link: data.referral_link 
            };
        } catch (err) {
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setLoading(false);
        }
    };

    const logout = () => {
        clearAuth();
    };

    const clearAuth = () => {
        setToken(null);
        setMerchant(null);
        setError(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(MERCHANT_KEY);
    };

    const value = {
        merchant,
        token,
        loading,
        error,
        isAuthenticated: !!token && !!merchant,
        login,
        register,
        logout,
        clearError: () => setError(null)
    };

    return (
        <MerchantAuthContext.Provider value={value}>
            {children}
        </MerchantAuthContext.Provider>
    );
}

export function useMerchantAuth() {
    const context = useContext(MerchantAuthContext);
    if (!context) {
        throw new Error('useMerchantAuth must be used within MerchantAuthProvider');
    }
    return context;
}

export default MerchantAuthContext;