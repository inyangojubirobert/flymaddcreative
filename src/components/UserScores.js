import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  ShareIcon, 
  ChartBarIcon, 
  TrophyIcon, 
  FireIcon,
  RocketLaunchIcon
} from '@heroicons/react/24/outline';

const UserScores = ({ user, userStats, onShare, isLoading }) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [animatedVotes, setAnimatedVotes] = useState(0);

  // Personal milestone configuration
  const personalMilestones = [
    { votes: 100, reward: '$200', badge: '🌱', name: 'Seedling' },
    { votes: 500, reward: '$1,000', badge: '🌿', name: 'Sprout' },
    { votes: 1000, reward: '$2,000', badge: '🌳', name: 'Growing Tree' },
    { votes: 5000, reward: '$10,000', badge: '🏆', name: 'Champion' },
    { votes: 10000, reward: '$20,000', badge: '👑', name: 'Dream King/Queen' }
  ];

  // Find current and next milestone
  const currentMilestone = personalMilestones.reduce((prev, current) => 
    (userStats?.totalVotes >= current.votes) ? current : prev
  );
  
  const nextMilestone = personalMilestones.find(m => 
    userStats?.totalVotes < m.votes
  ) || personalMilestones[personalMilestones.length - 1];

  const progressToNext = nextMilestone ? 
    ((userStats?.totalVotes || 0) / nextMilestone.votes) * 100 : 100;

  // Animate vote count on load
  useEffect(() => {
    if (userStats?.totalVotes) {
      const timer = setTimeout(() => {
        setAnimatedVotes(userStats.totalVotes);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [userStats?.totalVotes]);

  // Generate user's unique referral link
  const generateReferralLink = () => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/onedream?ref=${user?.referralCode || 'demo123'}`;
  };

  // Copy link to clipboard
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generateReferralLink());
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  // Social sharing functions
  const shareToSocial = (platform) => {
    const link = generateReferralLink();
    const text = `Help me reach my dream! Every vote counts towards building something amazing. Join the One Dream Initiative! 🌟`;
    
    const urls = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(text + ' ' + link)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`
    };
    
    window.open(urls[platform], '_blank', 'width=600,height=400');
    if (onShare) onShare(platform);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 animate-pulse">
        <div className="h-8 bg-gray-200 rounded mb-6"></div>
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
      {/* Header with Personal Stats */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-8 text-white">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-white bg-opacity-20 flex items-center justify-center text-2xl">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full object-cover" />
            ) : (
              user?.name?.charAt(0).toUpperCase() || '👤'
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold">{user?.name || 'Dream Builder'}</h2>
            <p className="opacity-90">Your Dream Journey</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Total Votes */}
          <motion.div 
            className="bg-white bg-opacity-20 rounded-xl p-4 text-center"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <div className="text-3xl font-bold mb-1">
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
              >
                {animatedVotes.toLocaleString()}
              </motion.span>
            </div>
            <div className="text-sm opacity-90">Total Votes</div>
            <div className="text-xs opacity-75 mt-1">
              Worth ${((userStats?.totalVotes || 0) * 2).toLocaleString()}
            </div>
          </motion.div>

          {/* Current Level */}
          <motion.div 
            className="bg-white bg-opacity-20 rounded-xl p-4 text-center"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className="text-2xl mb-1">{currentMilestone.badge}</div>
            <div className="font-semibold">{currentMilestone.name}</div>
            <div className="text-xs opacity-75 mt-1">Level {personalMilestones.indexOf(currentMilestone) + 1}</div>
          </motion.div>

          {/* Progress to Next */}
          <motion.div 
            className="bg-white bg-opacity-20 rounded-xl p-4 text-center"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <div className="text-2xl font-bold mb-1">{progressToNext.toFixed(1)}%</div>
            <div className="text-sm opacity-90">to {nextMilestone.name}</div>
            <div className="text-xs opacity-75 mt-1">
              {(nextMilestone.votes - (userStats?.totalVotes || 0)).toLocaleString()} votes away
            </div>
          </motion.div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Personal Progress Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <TrophyIcon className="w-6 h-6 text-yellow-500" />
            Your Progress Journey
          </h3>
          
          <div className="bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl p-6">
            <div className="flex justify-between items-center mb-3">
              <span className="font-medium text-gray-700">Progress to {nextMilestone.name}</span>
              <span className="text-sm text-gray-600">
                {userStats?.totalVotes || 0} / {nextMilestone.votes} votes
              </span>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden mb-3">
              <motion.div
                className="bg-gradient-to-r from-purple-500 to-blue-500 h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressToNext}%` }}
                transition={{ duration: 2, ease: "easeOut" }}
              />
            </div>
            
            <p className="text-center text-lg font-medium text-gray-700">
              🎯 You've reached {progressToNext.toFixed(1)}% of your goal! Keep sharing your dream.
            </p>
          </div>
        </motion.div>

        {/* Engagement Feedback */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <ChartBarIcon className="w-6 h-6 text-green-500" />
            Recent Activity
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {userStats?.todayVotes > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
                <FireIcon className="w-8 h-8 text-orange-500" />
                <div>
                  <div className="font-semibold text-orange-800">
                    🔥 Your dream gained {userStats.todayVotes} new supporters today!
                  </div>
                  <div className="text-sm text-orange-600">Keep the momentum going!</div>
                </div>
              </div>
            )}
            
            {nextMilestone && (userStats?.totalVotes || 0) > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
                <RocketLaunchIcon className="w-8 h-8 text-blue-500" />
                <div>
                  <div className="font-semibold text-blue-800">
                    🚀 You're {(nextMilestone.votes - (userStats?.totalVotes || 0)).toLocaleString()} votes away from {nextMilestone.name}!
                  </div>
                  <div className="text-sm text-blue-600">So close to {nextMilestone.reward}!</div>
                </div>
              </div>
            )}
          </div>

          {/* Vote Trend (Placeholder for chart) */}
          <div className="mt-4 bg-gray-50 rounded-xl p-4">
            <div className="text-sm font-medium text-gray-600 mb-2">7-Day Vote Trend</div>
            <div className="h-20 bg-gradient-to-r from-blue-200 to-purple-200 rounded-lg flex items-end justify-center">
              <div className="text-gray-600 text-sm">📊 Chart coming soon...</div>
            </div>
          </div>
        </motion.div>

        {/* Referral Link Manager */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <ShareIcon className="w-6 h-6 text-purple-500" />
            Share Your Dream
          </h3>
          
          {/* Unique Link */}
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your Unique Dream Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={generateReferralLink()}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-white text-sm"
              />
              <button
                onClick={copyToClipboard}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  copiedLink 
                    ? 'bg-green-500 text-white' 
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                {copiedLink ? '✅ Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Social Share Buttons */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              onClick={() => shareToSocial('twitter')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <span>🐦</span>
              <span className="font-medium">Twitter</span>
            </button>
            
            <button
              onClick={() => shareToSocial('facebook')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-700 text-white rounded-lg hover:bg-blue-800 transition-colors"
            >
              <span>📘</span>
              <span className="font-medium">Facebook</span>
            </button>
            
            <button
              onClick={() => shareToSocial('whatsapp')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
            >
              <span>💬</span>
              <span className="font-medium">WhatsApp</span>
            </button>
            
            <button
              onClick={() => shareToSocial('linkedin')}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-800 text-white rounded-lg hover:bg-blue-900 transition-colors"
            >
              <span>💼</span>
              <span className="font-medium">LinkedIn</span>
            </button>
          </div>

          {/* Call to Action */}
          <div className="mt-6 text-center p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-200">
            <p className="text-lg font-medium text-gray-800 mb-2">
              💫 Share again to boost your ranking!
            </p>
            <p className="text-sm text-gray-600">
              Each vote through your link gets you closer to amazing rewards
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default UserScores;