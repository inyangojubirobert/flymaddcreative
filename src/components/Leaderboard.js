import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const Leaderboard = ({ globalStats, participants, isLoading }) => {
  const [sortBy, setSortBy] = useState('allTime');
  const [animatedProgress, setAnimatedProgress] = useState(0);

  // Milestone stages configuration
  const stages = {
    bronze: { min: 0, max: 25, color: 'from-amber-600 to-amber-800', badge: '🥉', name: 'Bronze' },
    silver: { min: 26, max: 50, color: 'from-gray-400 to-gray-600', badge: '🥈', name: 'Silver' },
    gold: { min: 51, max: 75, color: 'from-yellow-400 to-yellow-600', badge: '🥇', name: 'Gold' },
    diamond: { min: 76, max: 100, color: 'from-blue-400 to-purple-600', badge: '💎', name: 'Diamond' }
  };

  // Calculate current stage based on progress
  const getCurrentStage = (progress) => {
    for (const [key, stage] of Object.entries(stages)) {
      if (progress >= stage.min && progress <= stage.max) {
        return { ...stage, key };
      }
    }
    return stages.bronze;
  };

  const globalProgress = globalStats ? (globalStats.totalVotes / 1000000) * 100 : 0;
  const currentStage = getCurrentStage(globalProgress);

  // Animate progress bar on load
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedProgress(globalProgress);
    }, 500);
    return () => clearTimeout(timer);
  }, [globalProgress]);

  // Sort participants based on selected criteria
  const sortedParticipants = participants ? [...participants].sort((a, b) => {
    switch (sortBy) {
      case 'thisRound':
        return b.roundVotes - a.roundVotes;
      case 'country':
        return a.country.localeCompare(b.country);
      default: // allTime
        return b.totalVotes - a.totalVotes;
    }
  }).slice(0, 10) : [];

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 animate-pulse">
        <div className="h-8 bg-gray-200 rounded mb-6"></div>
        <div className="h-6 bg-gray-200 rounded mb-8"></div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
      {/* Global Progress Section */}
      <div className={`bg-gradient-to-r ${currentStage.color} p-8 text-white`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-3xl font-bold mb-2">Community Progress</h2>
            <p className="text-lg opacity-90">Together, we're building dreams globally</p>
          </div>
          <div className="text-right">
            <div className="text-5xl mb-2">{currentStage.badge}</div>
            <div className="text-xl font-semibold">{currentStage.name} Stage</div>
          </div>
        </div>
        
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-lg font-medium">Global Progress</span>
            <span className="text-2xl font-bold">{globalProgress.toFixed(1)}%</span>
          </div>
          
          <div className="w-full bg-white bg-opacity-20 rounded-full h-4 overflow-hidden">
            <motion.div
              className="bg-white h-full rounded-full shadow-lg"
              initial={{ width: 0 }}
              animate={{ width: `${animatedProgress}%` }}
              transition={{ duration: 2, ease: "easeOut" }}
            />
          </div>
        </div>

        {globalProgress < 100 && (
          <motion.div
            className="text-center text-lg font-medium"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
          >
            🌟 {globalProgress < 25 ? "Let's reach Silver Stage!" : 
                globalProgress < 50 ? "Gold Stage awaits!" : 
                globalProgress < 75 ? "Diamond Stage is so close!" : 
                "Final push to 100%!"}
          </motion.div>
        )}
      </div>

      {/* Leaderboard Section */}
      <div className="p-8">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold text-gray-800">Top 10 Participants</h3>
          
          {/* Sort Controls */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            {[
              { key: 'allTime', label: 'All Time' },
              { key: 'thisRound', label: 'This Round' },
              { key: 'country', label: 'Country' }
            ].map((option) => (
              <button
                key={option.key}
                onClick={() => setSortBy(option.key)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  sortBy === option.key
                    ? 'bg-white shadow-md text-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Participant List */}
        <div className="space-y-4">
          {sortedParticipants.map((participant, index) => {
            const isTopThree = index < 3;
            const rankColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
            const progressPercentage = (participant.totalVotes / Math.max(...sortedParticipants.map(p => p.totalVotes))) * 100;

            return (
              <motion.div
                key={participant.id}
                className={`flex items-center p-4 rounded-xl border-2 transition-all hover:shadow-lg ${
                  isTopThree ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200' : 'bg-gray-50 border-gray-200'
                }`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                {/* Rank */}
                <div className={`text-2xl font-bold mr-4 min-w-[3rem] ${isTopThree ? rankColors[index] : 'text-gray-500'}`}>
                  {index < 3 ? ['🥇', '🥈', '🥉'][index] : `#${index + 1}`}
                </div>

                {/* Avatar/Flag */}
                <div className="mr-4">
                  {participant.avatar ? (
                    <img 
                      src={participant.avatar} 
                      alt={participant.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                      {participant.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Participant Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-gray-800 truncate">{participant.name}</h4>
                    {participant.country && (
                      <span className="text-xl" title={participant.country}>
                        {participant.countryFlag || '🌍'}
                      </span>
                    )}
                    {index < 10 && (
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-medium">
                        Weekly Highlight
                      </span>
                    )}
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                    <motion.div
                      className="bg-gradient-to-r from-blue-500 to-purple-600 h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercentage}%` }}
                      transition={{ duration: 1, delay: index * 0.1 }}
                    />
                  </div>
                  
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{participant.totalVotes.toLocaleString()} votes</span>
                    <span>{progressPercentage.toFixed(1)}%</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Motivational Footer */}
        <motion.div
          className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-200"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
        >
          <div className="text-center">
            <p className="text-lg font-medium text-gray-800 mb-2">
              ✨ Every vote counts — share your dream link to rise on the leaderboard ✨
            </p>
            <p className="text-sm text-gray-600">
              Join the movement and help us reach 1,000,000 dreams together!
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Leaderboard;