import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import VoteCard, { VoteStatsGrid } from '../../components/onedream/VoteCard';
import ProgressBar, { UserRankBar } from '../../components/onedream/ProgressBar';
import ShareButton, { QuickShareBar } from '../../components/onedream/ShareButton';
import { getGlobalStats, getTopWinners } from '../../lib/onedreamHelpers';
import { createClient } from '@supabase/supabase-js';

// Lazy initialization to avoid build-time errors
function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Protected Dashboard for One Dream Initiative participants
 * Shows user stats, referral link, leaderboard preview, and weekly feedback
 */
export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [globalStats, setGlobalStats] = useState(null);
  const [weeklyWinners, setWeeklyWinners] = useState([]);
  const [leaderboardPreview, setLeaderboardPreview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Get user referral URL
  const getReferralUrl = () => {
    if (!user?.referralToken) return '';
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    return `${baseUrl}/onedream/ref/${user.referralToken}`;
  };

  // Load dashboard data
  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Check authentication
      const token = localStorage.getItem('onedream_token');
      if (!token) {
        router.push('/onedream/login');
        return;
      }

      // Load user data (mock for now - replace with API call)
      const mockUser = {
        id: 'user-123',
        name: 'Demo User',
        email: 'demo@onedream.com',
        referralToken: 'abc123demo'
      };

      // Load user stats (mock data)
      const mockUserStats = {
        totalVotes: 1247,
        weeklyVotes: 89,
        rank: 23,
        totalValue: 2494
      };

      // Load global stats
      const globalData = await getGlobalStats();
      
      // Load weekly winners
      const weeklyData = await getTopWinners({ period: '7d', limit: 10 });
      
      // Load leaderboard preview
      const leaderboardData = await getTopWinners({ period: 'all', limit: 10 });

      setUser(mockUser);
      setUserStats(mockUserStats);
      setGlobalStats(globalData);
      setWeeklyWinners(weeklyData);
      setLeaderboardPreview(leaderboardData);

    } catch (err) {
      console.error('Dashboard loading error:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('onedream_token');
    router.push('/onedream');
  };

  // Handle payment/vote purchase
  const handleGetMoreVotes = () => {
    // Open payment modal or redirect to payment page
    alert('Payment integration coming soon! For now, share your link to get votes.');
  };

  // Handle share button click
  const handleShare = () => {
    // Share functionality is handled by the ShareButton component
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={loadDashboardData}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - One Dream Initiative | FlyMadd Creative</title>
        <meta name="description" content="Your One Dream Initiative dashboard" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Navigation */}
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-4">
                <Link href="/onedream">
                  <a className="text-blue-600 font-bold text-xl">One Dream Initiative</a>
                </Link>
                <span className="text-gray-400">|</span>
                <span className="text-gray-600">Dashboard</span>
              </div>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">Welcome, {user?.name}</span>
                <Link href="/onedream/leaderboard">
                  <a className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                    Leaderboard
                  </a>
                </Link>
                <button 
                  onClick={handleLogout}
                  className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <div className="px-4 py-6 sm:px-0">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Your Dashboard</h1>
              <p className="mt-2 text-gray-600">
                Track your progress, share your link, and climb the leaderboard
              </p>
            </div>

            {/* Stats Grid */}
            <VoteStatsGrid stats={userStats} className="mb-8" />

            {/* Main Dashboard Grid */}
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Left Column - Vote Card & Progress */}
              <div className="lg:col-span-1 space-y-6">
                {/* Vote Card */}
                <VoteCard
                  votes={userStats?.totalVotes || 0}
                  dollarValue={userStats?.totalValue || 0}
                  rank={userStats?.rank || 0}
                  onVoteClick={handleGetMoreVotes}
                  onShareClick={handleShare}
                />

                {/* User Progress */}
                <UserRankBar
                  userVotes={userStats?.totalVotes || 0}
                  nextMilestone={5000}
                  rank={userStats?.rank || 0}
                />
              </div>

              {/* Middle Column - Sharing & Activity */}
              <div className="lg:col-span-1 space-y-6">
                {/* Referral Link Section */}
                <div className="bg-white rounded-lg p-6 shadow border">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Your Referral Link
                  </h3>
                  
                  {/* URL Display */}
                  <div className="bg-gray-50 p-3 rounded border mb-4">
                    <p className="text-sm text-gray-600 break-all">
                      {getReferralUrl()}
                    </p>
                  </div>

                  {/* Share Buttons */}
                  <ShareButton
                    referralUrl={getReferralUrl()}
                    userName={user?.name || ''}
                    variant="primary"
                  />
                </div>

                {/* Activity Indicator */}
                <div className="bg-white rounded-lg p-6 shadow border">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Activity Indicator
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span>Votes Received vs Expected</span>
                        <span className="text-blue-600">{userStats?.totalVotes || 0} / {globalStats?.goalVotes || 1000000}</span>
                      </div>
                      <ProgressBar
                        current={userStats?.totalVotes || 0}
                        target={globalStats?.goalVotes || 1000000}
                        showValues={false}
                      />
                    </div>
                    
                    <div className="text-sm text-gray-600">
                      <p>Your votes are worth ${(userStats?.totalVotes * 2 || 0).toLocaleString()}. 
                         Keep sharing — you're {((userStats?.totalVotes || 0) / (globalStats?.goalVotes || 1000000) * 100).toFixed(2)}% toward the goal.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - Leaderboards */}
              <div className="lg:col-span-1 space-y-6">
                {/* Weekly Feedback */}
                <div className="bg-white rounded-lg p-6 shadow border">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Weekly Feedback
                    </h3>
                    <span className="text-sm text-gray-500">Last 7 Days</span>
                  </div>
                  
                  <div className="space-y-3">
                    {weeklyWinners.slice(0, 5).map((winner, index) => (
                      <div key={index} className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded">
                        <div className="text-sm font-medium text-blue-600">
                          #{index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{winner.name || 'Anonymous'}</p>
                          <p className="text-xs text-gray-500">{(winner.weekly_votes || 0).toLocaleString()} votes</p>
                        </div>
                        <div className="text-xs text-green-600 font-medium">
                          ${((winner.weekly_votes || 0) * 2).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <Link href="/onedream/leaderboard?period=7d">
                    <a className="block text-center text-sm text-blue-600 hover:text-blue-700 mt-4">
                      View All Weekly Winners →
                    </a>
                  </Link>
                </div>

                {/* Leaderboard Preview */}
                <div className="bg-white rounded-lg p-6 shadow border">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Top 10 Leaderboard
                    </h3>
                    <span className="text-sm text-gray-500">All Time</span>
                  </div>
                  
                  <div className="space-y-3">
                    {leaderboardPreview.slice(0, 5).map((leader, index) => (
                      <div key={index} className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded">
                        <div className="text-sm font-medium text-purple-600">
                          #{index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{leader.name || 'Anonymous'}</p>
                          <p className="text-xs text-gray-500">{(leader.total_votes || 0).toLocaleString()} votes</p>
                        </div>
                        <div className="text-xs text-green-600 font-medium">
                          ${((leader.total_votes || 0) * 2).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <Link href="/onedream/leaderboard">
                    <a className="block text-center text-sm text-blue-600 hover:text-blue-700 mt-4">
                      View Full Leaderboard →
                    </a>
                  </Link>
                </div>
              </div>
            </div>

            {/* Global Progress Section */}
            <div className="mt-8 bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-6 text-white">
              <h3 className="text-xl font-semibold mb-4">Global Progress</h3>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold">{(globalStats?.totalVotes || 0).toLocaleString()}</div>
                  <div className="text-blue-100">Total Votes</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">${(globalStats?.totalValueUSD || 0).toLocaleString()}</div>
                  <div className="text-blue-100">Total Value</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{(globalStats?.totalUsers || 0).toLocaleString()}</div>
                  <div className="text-blue-100">Participants</div>
                </div>
              </div>
              
              <div className="mt-6">
                <ProgressBar
                  current={globalStats?.totalVotes || 0}
                  target={globalStats?.goalVotes || 1000000}
                  label="Progress to 1 Million Vote Goal"
                  className="text-white"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}