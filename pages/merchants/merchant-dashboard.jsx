// pages/merchant/dashboard.jsx
import { useState, useEffect } from 'react';
import { useMerchantAuth } from '../../context/MerchantAuthContext';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function MerchantDashboard() {
    const [dashboardData, setDashboardData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
    const [newLinkDescription, setNewLinkDescription] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [creatingLink, setCreatingLink] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);
    
    const { merchant, token, logout, isAuthenticated } = useMerchantAuth();
    const router = useRouter();

    // Redirect if not authenticated
    useEffect(() => {
        if (!isAuthenticated && !loading) {
            router.push('/merchant/login');
        }
    }, [isAuthenticated, loading, router]);

    // Fetch dashboard data
    useEffect(() => {
        if (isAuthenticated && merchant?.id) {
            fetchDashboardData();
        }
    }, [isAuthenticated, merchant]);

    const fetchDashboardData = async () => {
        setLoading(true);
        setError('');
        
        try {
            const response = await fetch(`/api/merchants/${merchant.id}/dashboard`, {
                headers: {
                    'Authorization': token ? `Bearer ${token}` : ''
                }
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                setDashboardData(data);
            } else {
                setError(data.message || 'Failed to load dashboard');
            }
        } catch (err) {
            setError('Network error. Please try again.');
            console.error('Dashboard fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateLink = async () => {
        if (!newLinkDescription.trim()) {
            alert('Please enter a description');
            return;
        }
        
        setCreatingLink(true);
        
        try {
            const response = await fetch(`/api/merchants/${merchant.id}/links`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ description: newLinkDescription })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                alert('Referral link created successfully!');
                setShowCreateModal(false);
                setNewLinkDescription('');
                fetchDashboardData(); // Refresh data
            } else {
                alert(data.message || 'Failed to create link');
            }
        } catch (err) {
            alert('Network error. Please try again.');
            console.error('Create link error:', err);
        } finally {
            setCreatingLink(false);
        }
    };

    const handleWithdraw = async () => {
        const amount = parseInt(withdrawAmount);
        
        if (!amount || amount < 50) {
            alert('Minimum withdrawal is 50 tokens');
            return;
        }
        
        if (amount > (dashboardData?.stats?.available_tokens || 0)) {
            alert('Insufficient balance');
            return;
        }
        
        setWithdrawing(true);
        
        try {
            const response = await fetch(`/api/merchants/${merchant.id}/withdraw`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ amount })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                alert(`Withdrawal request for ${amount} tokens submitted successfully!`);
                setShowWithdrawModal(false);
                setWithdrawAmount('');
                fetchDashboardData(); // Refresh data
            } else {
                alert(data.message || 'Withdrawal failed');
            }
        } catch (err) {
            alert('Network error. Please try again.');
            console.error('Withdrawal error:', err);
        } finally {
            setWithdrawing(false);
        }
    };

    const toggleLinkStatus = async (linkId, currentStatus) => {
        try {
            const response = await fetch(`/api/merchants/links/${linkId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ is_active: !currentStatus })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                fetchDashboardData(); // Refresh data
            } else {
                alert(data.message || 'Failed to update link');
            }
        } catch (err) {
            alert('Network error. Please try again.');
            console.error('Toggle link error:', err);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            alert('Link copied to clipboard!');
        });
    };

    const handleLogout = () => {
        logout();
        router.push('/merchant/login');
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="spinner mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading your dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
                    <div className="text-red-500 text-5xl mb-4">⚠️</div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Error Loading Dashboard</h2>
                    <p className="text-gray-600 mb-6">{error}</p>
                    <button
                        onClick={fetchDashboardData}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const stats = dashboardData?.stats || {};
    const referralLinks = dashboardData?.referral_links || [];
    const recentActivity = dashboardData?.recent_activity || [];

    return (
        <>
            <Head>
                <title>Merchant Dashboard - One Dream Initiative</title>
            </Head>
            
            {/* Navigation */}
            <nav className="bg-white shadow-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="logo text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                            One Dream Initiative
                        </div>
                        <div className="flex items-center gap-2">
                            <Link href="/merchant/dashboard" className="nav-link active">Dashboard</Link>
                            <Link href="/merchant/links" className="nav-link">Links</Link>
                            <Link href="/merchant/withdraw" className="nav-link">Withdraw</Link>
                            <Link href="/merchant/settings" className="nav-link">Settings</Link>
                            <button onClick={handleLogout} className="logout-btn">
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Welcome Card */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-8 rounded-2xl mb-6">
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2">
                        Welcome back, <span>{dashboardData?.merchant?.merchant_name || 'Merchant'}</span>!
                    </h1>
                    <p className="text-indigo-100">Track your referrals, earnings, and payout status in real-time.</p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <div className="bg-white p-6 rounded-xl shadow-sm">
                        <p className="text-gray-500 text-sm mb-2">Total Referrals</p>
                        <p className="text-3xl font-bold text-gray-800">{stats.total_referrals || 0}</p>
                        <p className="text-green-500 text-sm mt-2">↑ +{stats.total_referrals || 0} total</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm">
                        <p className="text-gray-500 text-sm mb-2">Pending Votes</p>
                        <p className="text-3xl font-bold text-gray-800">{stats.pending_votes || 0}</p>
                        <p className="text-yellow-500 text-sm mt-2">Awaiting confirmation</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm">
                        <p className="text-gray-500 text-sm mb-2">Completed Votes</p>
                        <p className="text-3xl font-bold text-gray-800">{stats.completed_votes || 0}</p>
                        <p className="text-green-500 text-sm mt-2">Rewards earned</p>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm">
                        <p className="text-gray-500 text-sm mb-2">Conversion Rate</p>
                        <p className="text-3xl font-bold text-gray-800">{stats.conversion_rate || 0}%</p>
                        <p className="text-blue-500 text-sm mt-2">Visitors to voters</p>
                    </div>
                </div>

                {/* Tokens Card */}
                <div className="bg-gradient-to-r from-amber-50 to-yellow-100 p-6 rounded-xl mb-8 flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <h3 className="text-amber-800 font-semibold mb-2">Your Token Balance</h3>
                        <p className="text-4xl font-bold text-amber-900">{stats.total_tokens_earned || 0}</p>
                        <p className="text-amber-700 text-sm mt-1">{stats.pending_tokens || 0} tokens pending confirmation</p>
                    </div>
                    <button 
                        onClick={() => setShowWithdrawModal(true)}
                        className="bg-amber-800 text-white px-8 py-3 rounded-xl font-semibold hover:bg-amber-900 transition"
                    >
                        Withdraw Tokens
                    </button>
                </div>

                {/* Referral Links Section */}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Your Referral Links</h2>
                    <button 
                        onClick={() => setShowCreateModal(true)}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition"
                    >
                        + Create New Link
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    {referralLinks.map(link => {
                        const conversionRate = link.clicks_count > 0 
                            ? Math.round((link.registrations_count / link.clicks_count) * 100) 
                            : 0;
                        
                        return (
                            <div key={link.id} className="bg-white p-5 rounded-xl shadow-sm">
                                <div className="flex justify-between items-center mb-3">
                                    <span className="bg-gray-100 px-3 py-1 rounded-full text-xs font-semibold text-gray-700">
                                        {link.link_code}
                                    </span>
                                    <span className={`w-2.5 h-2.5 rounded-full ${link.is_active ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                                </div>
                                <div className="bg-gray-50 p-3 rounded-lg font-mono text-xs break-all mb-3">
                                    {link.full_link}
                                </div>
                                <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                                    <div>
                                        <p className="text-lg font-bold text-gray-800">{link.clicks_count || 0}</p>
                                        <p className="text-xs text-gray-500">Clicks</p>
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-gray-800">{link.registrations_count || 0}</p>
                                        <p className="text-xs text-gray-500">Signups</p>
                                    </div>
                                    <div>
                                        <p className="text-lg font-bold text-gray-800">{conversionRate}%</p>
                                        <p className="text-xs text-gray-500">Conv.</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={() => copyToClipboard(link.full_link)}
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition"
                                    >
                                        Copy
                                    </button>
                                    <button 
                                        onClick={() => toggleLinkStatus(link.id, link.is_active)}
                                        className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 transition"
                                    >
                                        {link.is_active ? 'Deactivate' : 'Activate'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    
                    {referralLinks.length === 0 && (
                        <div className="col-span-full bg-gray-50 p-8 rounded-xl text-center">
                            <p className="text-gray-500 mb-3">You haven't created any referral links yet.</p>
                            <button 
                                onClick={() => setShowCreateModal(true)}
                                className="text-indigo-600 font-semibold hover:text-indigo-700"
                            >
                                Create your first link →
                            </button>
                        </div>
                    )}
                </div>

                {/* Recent Referrals Table */}
                <h2 className="text-xl font-bold text-gray-800 mb-4">Recent Referrals & Earnings</h2>
                
                <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
                    <table className="w-full min-w-[800px]">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Participant</th>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Registered</th>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Link Used</th>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Vote Status</th>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Vote Date</th>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Tokens</th>
                                <th className="text-left p-4 text-sm font-semibold text-gray-600">Reward Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentActivity.map((activity, index) => {
                                const initial = activity.participant?.name?.charAt(0) || '?';
                                
                                return (
                                    <tr key={index} className="border-t border-gray-100 hover:bg-gray-50">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white font-semibold">
                                                    {initial}
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-gray-800">{activity.participant?.name}</h4>
                                                    <p className="text-sm text-gray-500">{activity.participant?.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm text-gray-600">
                                            {new Date(activity.registered_date).toLocaleDateString()}
                                        </td>
                                        <td className="p-4">
                                            <span className="bg-gray-100 px-3 py-1 rounded-full text-xs font-semibold text-gray-700">
                                                {activity.link_used}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`status-badge ${activity.vote?.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'} px-3 py-1 rounded-full text-xs font-semibold`}>
                                                {activity.vote?.status === 'confirmed' ? '✅ Voted' : '⏳ Pending'}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm text-gray-600">
                                            {activity.vote?.date ? new Date(activity.vote.date).toLocaleDateString() : '-'}
                                        </td>
                                        <td className="p-4 font-bold text-green-600">
                                            {activity.reward?.tokens || 0} tokens
                                        </td>
                                        <td className="p-4">
                                            <span className={`status-badge ${
                                                activity.reward?.status === 'paid' 
                                                    ? 'bg-purple-100 text-purple-700' 
                                                    : activity.reward?.status === 'pending'
                                                    ? 'bg-blue-100 text-blue-700'
                                                    : 'bg-gray-100 text-gray-700'
                                            } px-3 py-1 rounded-full text-xs font-semibold`}>
                                                {activity.reward?.status === 'paid' 
                                                    ? '💰 Paid' 
                                                    : activity.reward?.status === 'pending'
                                                    ? '⏳ Pending'
                                                    : 'No vote yet'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            
                            {recentActivity.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="text-center p-8 text-gray-500">
                                        No referrals yet. Share your links to start earning!
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Link Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Create New Referral Link</h3>
                        <input
                            type="text"
                            value={newLinkDescription}
                            onChange={(e) => setNewLinkDescription(e.target.value)}
                            placeholder="Link description (e.g., Twitter, Website)"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateLink}
                                disabled={creatingLink}
                                className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
                            >
                                {creatingLink ? 'Creating...' : 'Create Link'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Withdraw Modal */}
            {showWithdrawModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Withdraw Tokens</h3>
                        <p className="text-gray-600 mb-2">
                            Available balance: <span className="font-bold text-amber-600">{stats.available_tokens || 0}</span> tokens
                        </p>
                        <input
                            type="number"
                            value={withdrawAmount}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                            placeholder="Amount to withdraw"
                            min="50"
                            step="1"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg mb-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <p className="text-xs text-gray-500 mb-4">Minimum withdrawal: 50 tokens</p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowWithdrawModal(false)}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleWithdraw}
                                disabled={withdrawing}
                                className="flex-1 px-4 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition disabled:opacity-50"
                            >
                                {withdrawing ? 'Processing...' : 'Withdraw'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                .nav-link {
                    color: #4a5568;
                    text-decoration: none;
                    padding: 8px 16px;
                    border-radius: 8px;
                    transition: background 0.2s;
                }
                .nav-link:hover {
                    background: #f7fafc;
                }
                .nav-link.active {
                    background: #667eea;
                    color: white;
                }
                .logout-btn {
                    background: none;
                    border: 1px solid #e2e8f0;
                    padding: 8px 16px;
                    border-radius: 8px;
                    cursor: pointer;
                    color: #4a5568;
                    margin-left: 8px;
                }
                .logout-btn:hover {
                    background: #f7fafc;
                }
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid #e2e8f0;
                    border-top-color: #667eea;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </>
    );
}