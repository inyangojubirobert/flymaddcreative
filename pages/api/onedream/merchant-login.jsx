// pages/merchant-register.jsx
import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../context/MerchantAuthContext';
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function MerchantRegister() {
    const [formData, setFormData] = useState({
        merchant_name: '',
        email: '',
        company_name: '',
        wallet_address: '',
        password: '',
        confirmPassword: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [agreeTerms, setAgreeTerms] = useState(false);
    const [localError, setLocalError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [registrationSuccess, setRegistrationSuccess] = useState(false);
    const [referralLink, setReferralLink] = useState(null);
    
    const { register, error: authError, clearError, isAuthenticated } = useMerchantAuth();
    const router = useRouter();

    // Redirect if already authenticated
    useEffect(() => {
        if (isAuthenticated) {
            router.push('/merchant-dashboard');
        }
    }, [isAuthenticated, router]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
        // Clear field-specific errors when user types
        setLocalError('');
        clearError?.();
    };

    const validateForm = () => {
        if (!formData.merchant_name.trim()) {
            setLocalError('Merchant name is required');
            return false;
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.email)) {
            setLocalError('Please enter a valid email address');
            return false;
        }
        
        if (formData.password.length < 8) {
            setLocalError('Password must be at least 8 characters');
            return false;
        }
        
        if (formData.password !== formData.confirmPassword) {
            setLocalError('Passwords do not match');
            return false;
        }
        
        if (formData.wallet_address) {
            const ethPattern = /^0x[a-fA-F0-9]{40}$/;
            const solPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
            if (!ethPattern.test(formData.wallet_address) && !solPattern.test(formData.wallet_address)) {
                setLocalError('Please enter a valid wallet address (Ethereum or Solana format)');
                return false;
            }
        }
        
        if (!agreeTerms) {
            setLocalError('Please agree to the Terms of Service');
            return false;
        }
        
        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError('');
        clearError?.();
        
        if (!validateForm()) {
            return;
        }
        
        setIsLoading(true);
        
        try {
            const result = await register({
                merchant_name: formData.merchant_name,
                email: formData.email,
                company_name: formData.company_name || null,
                wallet_address: formData.wallet_address || null,
                password: formData.password
            });
            
            if (result.success) {
                setRegistrationSuccess(true);
                setReferralLink(result.referral_link);
                // Reset form
                setFormData({
                    merchant_name: '',
                    email: '',
                    company_name: '',
                    wallet_address: '',
                    password: '',
                    confirmPassword: ''
                });
            } else {
                setLocalError(result.error || 'Registration failed');
            }
        } catch (err) {
            setLocalError('An unexpected error occurred');
            console.error('Registration error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Success View
    if (registrationSuccess) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                    {/* Success Header */}
                    <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-8 py-6 text-center">
                        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-white">Registration Successful!</h1>
                        <p className="text-green-100 mt-1">Your merchant account is ready</p>
                    </div>

                    <div className="p-8">
                        {/* Referral Link Box */}
                        {referralLink && (
                            <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-6 mb-6">
                                <h3 className="text-lg font-semibold text-indigo-900 mb-3">🔗 Your Unique Referral Link</h3>
                                <div className="bg-white p-3 rounded-lg border border-indigo-200 mb-3 font-mono text-sm break-all">
                                    {referralLink.full_link || referralLink}
                                </div>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(referralLink.full_link || referralLink);
                                        alert('Link copied to clipboard!');
                                    }}
                                    className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition font-medium"
                                >
                                    Copy Link
                                </button>
                            </div>
                        )}

                        {/* Next Steps */}
                        <div className="space-y-4 mb-6">
                            <h4 className="font-semibold text-gray-800">📋 Next Steps:</h4>
                            <ul className="space-y-3">
                                <li className="flex items-start gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                                    <span className="text-gray-600">Share your unique link on social media, website, or with friends</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                                    <span className="text-gray-600">When someone registers using your link, they'll be tracked to you</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold">3</span>
                                    <span className="text-gray-600">Earn <span className="font-bold text-indigo-600">50 tokens</span> for every confirmed vote they make</span>
                                </li>
                                <li className="flex items-start gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-sm font-bold">4</span>
                                    <span className="text-gray-600">Track all your earnings in real-time on your dashboard</span>
                                </li>
                            </ul>
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-3">
                            <Link
                                href="/merchant-login"
                                className="block w-full bg-indigo-600 text-white text-center py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 transition"
                            >
                                Go to Login →
                            </Link>
                            <Link
                                href="/"
                                className="block w-full bg-gray-100 text-gray-700 text-center py-3 px-4 rounded-lg font-medium hover:bg-gray-200 transition"
                            >
                                Back to Home
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Registration Form View
    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-6">
                    <h1 className="text-2xl font-bold text-white">Become a Merchant</h1>
                    <p className="text-indigo-100 mt-1">Earn 50 tokens for every referred vote</p>
                </div>

                {/* Benefits Badge */}
                <div className="bg-yellow-50 px-8 py-3 border-b border-yellow-100">
                    <p className="text-yellow-800 text-sm flex items-center">
                        <span className="font-bold text-lg mr-2">💰</span>
                        <span><span className="font-bold">50 tokens</span> per confirmed vote from your referrals</span>
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-8 space-y-5">
                    {/* Error Message */}
                    {(localError || authError) && (
                        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                            <p className="text-red-700 text-sm">{localError || authError}</p>
                        </div>
                    )}

                    {/* Merchant Name */}
                    <div>
                        <label htmlFor="merchant_name" className="block text-sm font-medium text-gray-700 mb-1">
                            Merchant Name *
                        </label>
                        <input
                            id="merchant_name"
                            name="merchant_name"
                            type="text"
                            value={formData.merchant_name}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Your name or business"
                            required
                            disabled={isLoading}
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                            Email Address *
                        </label>
                        <input
                            id="email"
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="merchant@example.com"
                            required
                            disabled={isLoading}
                        />
                    </div>

                    {/* Company Name (Optional) */}
                    <div>
                        <label htmlFor="company_name" className="block text-sm font-medium text-gray-700 mb-1">
                            Company Name <span className="text-gray-400">(Optional)</span>
                        </label>
                        <input
                            id="company_name"
                            name="company_name"
                            type="text"
                            value={formData.company_name}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Your company"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Wallet Address (Optional) */}
                    <div>
                        <label htmlFor="wallet_address" className="block text-sm font-medium text-gray-700 mb-1">
                            Wallet Address <span className="text-gray-400">(Optional)</span>
                        </label>
                        <input
                            id="wallet_address"
                            name="wallet_address"
                            type="text"
                            value={formData.wallet_address}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="0x... or Solana address"
                            disabled={isLoading}
                        />
                        <p className="text-xs text-gray-500 mt-1">For token withdrawals</p>
                    </div>

                    {/* Password */}
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                            Password *
                        </label>
                        <div className="relative">
                            <input
                                id="password"
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={handleChange}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 pr-10"
                                placeholder="Minimum 8 characters"
                                required
                                disabled={isLoading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                            >
                                {showPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                        </div>
                    </div>

                    {/* Confirm Password */}
                    <div>
                        <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                            Confirm Password *
                        </label>
                        <div className="relative">
                            <input
                                id="confirmPassword"
                                name="confirmPassword"
                                type={showConfirmPassword ? 'text' : 'password'}
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 pr-10"
                                placeholder="Re-enter password"
                                required
                                disabled={isLoading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500"
                            >
                                {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                            </button>
                        </div>
                    </div>

                    {/* Terms Agreement */}
                    <div className="flex items-start">
                        <input
                            id="terms"
                            type="checkbox"
                            checked={agreeTerms}
                            onChange={(e) => setAgreeTerms(e.target.checked)}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mt-1"
                            required
                        />
                        <label htmlFor="terms" className="ml-2 block text-sm text-gray-600">
                            I agree to the <a href="#" className="text-indigo-600 hover:text-indigo-500">Terms of Service</a> and <a href="#" className="text-indigo-600 hover:text-indigo-500">Privacy Policy</a>
                        </label>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition disabled:opacity-50"
                    >
                        {isLoading ? (
                            <span className="flex items-center justify-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Registering...
                            </span>
                        ) : (
                            'Register as Merchant'
                        )}
                    </button>

                    {/* Login Link */}
                    <div className="text-center mt-4">
                        <p className="text-sm text-gray-600">
                            Already have an account?{' '}
                            <Link href="/merchant-login" className="text-indigo-600 hover:text-indigo-500 font-medium">
                                Login here
                            </Link>
                        </p>
                    </div>

                    {/* Back Link */}
                    <div className="border-t pt-4 mt-2">
                        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                            </svg>
                            Back to Main Site
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
}