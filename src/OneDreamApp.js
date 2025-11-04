/**
 * OneDreamApp.js - Main integration file for the One Dream Initiative
 * This file connects all React components to the existing HTML structure
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Leaderboard from './components/Leaderboard.js';
import UserScores from './components/UserScores.js';
import SharedLinkHandler from './components/SharedLinkHandler.js';
import { supabase, getLeaderboard, getGlobalStats, getUserStats } from './backend/supabase.js';

// Main App Component
const OneDreamApp = () => {
  // State management
  const [isLoading, setIsLoading] = useState(true);
  const [globalStats, setGlobalStats] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [activeView, setActiveView] = useState('leaderboard'); // 'leaderboard' or 'userscores'
  const [error, setError] = useState(null);

  // Initialize the app
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Initialize link handler
      const linkHandler = new SharedLinkHandler(supabase);
      await linkHandler.initialize();

      // Load initial data
      await Promise.all([
        loadGlobalStats(),
        loadLeaderboard(),
        checkUserSession()
      ]);

      // Set up real-time subscriptions
      setupRealtimeSubscriptions();

    } catch (err) {
      console.error('Error initializing app:', err);
      setError('Failed to load data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  // Load global statistics
  const loadGlobalStats = async () => {
    const result = await getGlobalStats();
    if (result.success) {
      setGlobalStats(result.data);
    } else {
      console.error('Error loading global stats:', result.error);
    }
  };

  // Load leaderboard data
  const loadLeaderboard = async (sortBy = 'allTime') => {
    const result = await getLeaderboard(sortBy, 10);
    if (result.success) {
      setParticipants(result.data);
    } else {
      console.error('Error loading leaderboard:', result.error);
    }
  };

  // Check if user is logged in
  const checkUserSession = async () => {
    // This would typically check authentication state
    // For demo purposes, we'll simulate a user
    const demoUser = {
      id: 'demo-user-123',
      name: 'Demo User',
      email: 'demo@onedream.com',
      referralCode: 'demo123',
      avatar: null
    };

    // Check if user is in URL parameters or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('user') || localStorage.getItem('onedream_user_id');
    
    if (userId) {
      setCurrentUser(demoUser);
      await loadUserStats(demoUser.id);
    }
  };

  // Load user statistics
  const loadUserStats = async (userId) => {
    const result = await getUserStats(userId);
    if (result.success) {
      setUserStats(result.data);
    } else {
      console.error('Error loading user stats:', result.error);
    }
  };

  // Set up real-time subscriptions
  const setupRealtimeSubscriptions = () => {
    // Subscribe to global stats changes
    const globalStatsSubscription = supabase
      .channel('global-stats-changes')
      .on('postgres_changes', 
        { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'global_stats' 
        }, 
        (payload) => {
          setGlobalStats(payload.new);
        }
      )
      .subscribe();

    // Subscribe to leaderboard changes
    const leaderboardSubscription = supabase
      .channel('leaderboard-changes')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'participants' 
        }, 
        () => {
          loadLeaderboard(); // Reload leaderboard data
        }
      )
      .subscribe();

    // Cleanup subscriptions on unmount
    return () => {
      globalStatsSubscription.unsubscribe();
      leaderboardSubscription.unsubscribe();
    };
  };

  // Handle share action
  const handleShare = (platform) => {
    console.log(`Shared on ${platform}`);
    // Track sharing event
    if (currentUser) {
      supabase.from('analytics_events').insert({
        event_name: 'share_clicked',
        event_data: { platform },
        participant_id: currentUser.id
      });
    }
  };

  // Handle view switching
  const switchView = (view) => {
    setActiveView(view);
  };

  // Login simulation (for demo)
  const handleLogin = () => {
    const demoUser = {
      id: 'demo-user-123',
      name: 'Demo User',
      email: 'demo@onedream.com',
      referralCode: 'demo123',
      avatar: null
    };
    
    setCurrentUser(demoUser);
    localStorage.setItem('onedream_user_id', demoUser.id);
    loadUserStats(demoUser.id);
    setActiveView('userscores');
  };

  // Logout
  const handleLogout = () => {
    setCurrentUser(null);
    setUserStats(null);
    localStorage.removeItem('onedream_user_id');
    setActiveView('leaderboard');
  };

  // Error boundary
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-pink-50">
        <div className="text-center p-8">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Oops! Something went wrong</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="btn btn-primary"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold gradient-text">One Dream Initiative</h1>
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                <span>🎯</span>
                <span>1M Dreams Goal</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* View switcher */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => switchView('leaderboard')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeView === 'leaderboard'
                      ? 'bg-white shadow-md text-blue-600'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  🏆 Leaderboard
                </button>
                <button
                  onClick={() => switchView('userscores')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeView === 'userscores'
                      ? 'bg-white shadow-md text-blue-600'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                  disabled={!currentUser}
                >
                  📊 My Stats
                </button>
              </div>
              
              {/* User menu */}
              {currentUser ? (
                <div className="flex items-center gap-3">
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">Hello, {currentUser.name}!</div>
                  </div>
                  <button onClick={handleLogout} className="btn btn-ghost text-sm">
                    Logout
                  </button>
                </div>
              ) : (
                <button onClick={handleLogin} className="btn btn-primary">
                  Login to Track Progress
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeView === 'leaderboard' ? (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                🌟 Global Dream Leaderboard 🌟
              </h2>
              <p className="text-lg text-gray-600">
                See who's leading the charge towards 1 million dreams!
              </p>
            </div>
            
            <Leaderboard 
              globalStats={globalStats}
              participants={participants}
              isLoading={isLoading}
            />
          </div>
        ) : (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                📊 Your Dream Journey 📊
              </h2>
              <p className="text-lg text-gray-600">
                Track your progress and share your dream with the world!
              </p>
            </div>
            
            {currentUser ? (
              <UserScores 
                user={currentUser}
                userStats={userStats}
                onShare={handleShare}
                isLoading={isLoading}
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔐</div>
                <h3 className="text-2xl font-bold text-gray-800 mb-2">Login Required</h3>
                <p className="text-gray-600 mb-6">Please login to view your personal statistics and share your dream.</p>
                <button onClick={handleLogin} className="btn btn-primary">
                  Login Now
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h3 className="text-2xl font-bold mb-2">One Dream Initiative</h3>
            <p className="text-gray-400 mb-4">
              Building dreams together, one vote at a time.
            </p>
            <div className="flex justify-center space-x-6 text-sm">
              <a href="#" className="hover:text-blue-400 transition-colors">About</a>
              <a href="#" className="hover:text-blue-400 transition-colors">Contact</a>
              <a href="#" className="hover:text-blue-400 transition-colors">Privacy</a>
              <a href="#" className="hover:text-blue-400 transition-colors">Terms</a>
            </div>
            <div className="mt-4 text-sm text-gray-500">
              © 2025 One Dream Initiative. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

// Initialize the app when DOM is ready
const initializeOneDreamApp = () => {
  // Check if we're on the One Dream page
  const targetElement = document.getElementById('onedream-app-root');
  
  if (targetElement) {
    const root = createRoot(targetElement);
    root.render(<OneDreamApp />);
  } else {
    console.warn('One Dream app root element not found. Make sure #onedream-app-root exists in the HTML.');
  }
};

// Export for use in other modules
export { OneDreamApp, initializeOneDreamApp };

// Auto-initialize if DOM is already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeOneDreamApp);
} else {
  initializeOneDreamApp();
}