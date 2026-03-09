// pages/merchant/register.jsx
import { useState } from 'react';
import { useMerchantAuth } from '../../context/MerchantAuthContext';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function MerchantRegister() {
    const [formData, setFormData] = useState({
        merchantName: '',
        email: '',
        companyName: '',
        walletAddress: '',
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

    const handleChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [id]: value
        }));
        setLocalError('');
        clearError?.();
    };

    const validateForm = () => {
        if (!formData.merchantName.trim()) {
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
        
        if (formData.walletAddress) {
            const ethPattern = /^0x[a-fA-F0-9]{40}$/;
            const solPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
            if (!ethPattern.test(formData.walletAddress) && !solPattern.test(formData.walletAddress)) {
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
        
        if (!validateForm()) return;
        
        setIsLoading(true);
        
        try {
            const result = await register({
                merchant_name: formData.merchantName,
                email: formData.email,
                company_name: formData.companyName || null,
                wallet_address: formData.walletAddress || null,
                password: formData.password
            });
            
            if (result.success) {
                setRegistrationSuccess(true);
                setReferralLink(result.referral_link);
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
            <>
                <Head>
                    <title>Registration Successful - One Dream Initiative</title>
                </Head>
                <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
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
                            {referralLink && (
                                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-6 mb-6">
                                    <h3 className="text-lg font-semibold text-indigo-900 mb-3">🔗 Your Unique Referral Link</h3>
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200 mb-3 font-mono text-sm break-all">
                                        {referralLink?.full_link || referralLink}
                                    </div>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(referralLink?.full_link || referralLink);
                                            alert('Link copied to clipboard!');
                                        }}
                                        className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition font-medium"
                                    >
                                        Copy Link
                                    </button>
                                </div>
                            )}

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

                            <div className="space-y-3">
                                <Link
                                    href="/merchant/login"
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
            </>
        );
    }

    // Registration Form View
    return (
        <>
            <Head>
                <title>Merchant Registration - One Dream Initiative</title>
            </Head>
            <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-6">
                        <h1 className="text-2xl font-bold text-white">Become a Merchant</h1>
                        <p className="text-indigo-100 mt-1">Earn 50 tokens for every referred vote</p>
                        <div className="inline-block bg-white/20 backdrop-blur-sm px-6 py-2 rounded-full mt-4 font-bold text-white border border-white/30">
                            💰 50 Tokens Per Vote
                        </div>
                    </div>

                    <div className="p-8">
                        <div className="grid grid-cols-2 gap-4 mb-8">
                            {[
                                { icon: '🎯', title: 'Unlimited Referrals', desc: 'No caps on earnings' },
                                { icon: '⚡', title: 'Instant Tracking', desc: 'Real-time dashboard' },
                                { icon: '💰', title: 'Withdraw Anytime', desc: 'Tokens to wallet' },
                                { icon: '📊', title: 'Analytics', desc: 'Track performance' }
                            ].map((item, i) => (
                                <div key={i} className="bg-gray-50 p-4 rounded-xl text-center border border-gray-200">
                                    <div className="text-3xl mb-2">{item.icon}</div>
                                    <h3 className="font-semibold text-gray-800 text-sm">{item.title}</h3>
                                    <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                                </div>
                            ))}
                        </div>

                        <div className="bg-gradient-to-br from-amber-50 to-yellow-100 p-5 rounded-xl mb-8 text-center border border-amber-200">
                            <p className="text-amber-800 text-sm uppercase tracking-wide mb-2">Your Earning Potential</p>
                            <p className="text-4xl font-bold text-amber-900">50 Tokens</p>
                            <p className="text-amber-700 text-sm mt-2">per confirmed vote from your referrals</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {(localError || authError) && (
                                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
                                    <p className="text-red-700 text-sm">{localError || authError}</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Full Name / Business Name *
                                </label>
                                <input
                                    id="merchantName"
                                    type="text"
                                    value={formData.merchantName}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="John Doe or Company Name"
                                    required
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Email Address *
                                </label>
                                <input
                                    id="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="your@email.com"
                                    required
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Company Name <span className="text-gray-400">(Optional)</span>
                                </label>
                                <input
                                    id="companyName"
                                    type="text"
                                    value={formData.companyName}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="Your company"
                                    disabled={isLoading}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Wallet Address <span className="text-gray-400">(Optional)</span>
                                </label>
                                <input
                                    id="walletAddress"
                                    type="text"
                                    value={formData.walletAddress}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="0x... or Solana address"
                                    disabled={isLoading}
                                />
                                <p className="text-xs text-gray-500 mt-1">For token withdrawals</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Password *
                                </label>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={formData.password}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 pr-12"
                                        placeholder="Minimum 8 characters"
                                        required
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                    >
                                        {showPassword ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Confirm Password *
                                </label>
                                <div className="relative">
                                    <input
                                        id="confirmPassword"
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        value={formData.confirmPassword}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 pr-12"
                                        placeholder="Re-enter password"
                                        required
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                    >
                                        {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <input
                                    id="terms"
                                    type="checkbox"
                                    checked={agreeTerms}
                                    onChange={(e) => setAgreeTerms(e.target.checked)}
                                    className="w-5 h-5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 mt-0.5"
                                    required
                                />
                                <label htmlFor="terms" className="text-sm text-gray-600">
                                    I agree to the <a href="#" className="text-indigo-600 hover:text-indigo-500">Terms of Service</a> and <a href="#" className="text-indigo-600 hover:text-indigo-500">Privacy Policy</a>
                                </label>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:from-indigo-700 hover:to-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
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

                            <div className="text-center mt-4">
                                <p className="text-sm text-gray-600">
                                    Already registered?{' '}
                                <Link href="/merchants/merchant-login" className="text-indigo-600 hover:text-indigo-500 font-medium">
                             Login here
                              </Link>
                                </p>
                            </div>

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
            </div>
        </>
    );
}