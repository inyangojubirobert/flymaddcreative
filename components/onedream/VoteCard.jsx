import { useState } from 'react';

/**
 * Vote Card Component - Displays votes, dollar value and CTA buttons
 * Used in dashboard and user profile sections
 */
const VoteCard = ({ 
  votes = 0, 
  dollarValue = 0, 
  rank = 0,
  onVoteClick,
  onShareClick,
  showActions = true,
  isLoading = false,
  className = ""
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const formattedVotes = votes.toLocaleString();
  const formattedValue = dollarValue.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });

  return (
    <div 
      className={`
        bg-gradient-to-br from-blue-50 to-blue-100 
        rounded-xl p-6 border border-blue-200 
        transition-all duration-300 hover:shadow-lg
        ${isHovered ? 'transform scale-105' : ''}
        ${className}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">
          Your Current Standing
        </h3>
        {rank > 0 && (
          <p className="text-sm text-blue-600 font-medium">
            Rank #{rank}
          </p>
        )}
      </div>

      {/* Vote Count */}
      <div className="text-center mb-4">
        <div className="text-4xl font-bold text-blue-600 mb-2">
          {isLoading ? (
            <div className="animate-pulse bg-blue-200 h-12 w-32 mx-auto rounded"></div>
          ) : (
            formattedVotes
          )}
        </div>
        <p className="text-gray-600 text-sm">
          Total Votes
        </p>
      </div>

      {/* Dollar Value */}
      <div className="text-center mb-6">
        <div className="text-2xl font-semibold text-green-600 mb-1">
          {isLoading ? (
            <div className="animate-pulse bg-green-200 h-8 w-24 mx-auto rounded"></div>
          ) : (
            formattedValue
          )}
        </div>
        <p className="text-gray-500 text-xs">
          Equivalent Value
        </p>
      </div>

      {/* Progress Indicator */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-gray-600">Progress to Goal</span>
          <span className="text-xs text-blue-600 font-medium">
            {((votes / 1000000) * 100).toFixed(2)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${Math.min((votes / 1000000) * 100, 100)}%` }}
          ></div>
        </div>
      </div>

      {/* Action Buttons */}
      {showActions && (
        <div className="space-y-3">
          <button
            onClick={onVoteClick}
            disabled={isLoading}
            className="
              w-full bg-blue-600 hover:bg-blue-700 
              text-white font-medium py-3 px-4 rounded-lg
              transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            "
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Processing...
              </div>
            ) : (
              'Get More Votes'
            )}
          </button>

          <button
            onClick={onShareClick}
            disabled={isLoading}
            className="
              w-full bg-yellow-500 hover:bg-yellow-600 
              text-white font-medium py-3 px-4 rounded-lg
              transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2
            "
          >
            Share Your Link
          </button>
        </div>
      )}

      {/* Motivational Message */}
      <div className="mt-4 text-center">
        <p className="text-xs text-gray-600">
          {votes > 0 
            ? `Your votes are worth ${formattedValue}. Keep sharing — you're ${((votes / 1000000) * 100).toFixed(2)}% toward the goal.`
            : "Start sharing your link to earn votes and climb the leaderboard!"
          }
        </p>
      </div>
    </div>
  );
};

/**
 * Compact Vote Card - Smaller version for lists and grids
 */
export const CompactVoteCard = ({ 
  votes = 0, 
  dollarValue = 0,
  rank = 0,
  name = "Anonymous",
  className = ""
}) => {
  const formattedVotes = votes.toLocaleString();
  const formattedValue = dollarValue.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });

  return (
    <div className={`
      bg-white rounded-lg p-4 border border-gray-200
      hover:border-blue-300 hover:shadow-md transition-all duration-200
      ${className}
    `}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-sm font-medium text-blue-600">
            #{rank}
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">{name}</p>
            <p className="text-xs text-gray-500">{formattedVotes} votes</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-green-600">
            {formattedValue}
          </p>
          <div className="w-16 bg-gray-200 rounded-full h-1 mt-1">
            <div 
              className="bg-blue-500 h-1 rounded-full"
              style={{ width: `${Math.min((votes / 10000) * 100, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Vote Stats Grid - Display multiple vote statistics
 */
export const VoteStatsGrid = ({ stats = {}, className = "" }) => {
  const {
    totalVotes = 0,
    weeklyVotes = 0,
    rank = 0,
    totalValue = 0
  } = stats;

  const statItems = [
    {
      label: 'Total Votes',
      value: totalVotes.toLocaleString(),
      color: 'blue',
      icon: '🗳️'
    },
    {
      label: 'This Week',
      value: weeklyVotes.toLocaleString(),
      color: 'green',
      icon: '📅'
    },
    {
      label: 'Current Rank',
      value: `#${rank}`,
      color: 'purple',
      icon: '🏆'
    },
    {
      label: 'Total Value',
      value: `$${totalValue.toLocaleString()}`,
      color: 'yellow',
      icon: '💰'
    }
  ];

  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {statItems.map((item, index) => (
        <div
          key={index}
          className={`
            bg-white rounded-lg p-4 border border-gray-200
            hover:border-${item.color}-300 hover:shadow-md 
            transition-all duration-200
          `}
        >
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-lg">{item.icon}</span>
            <span className="text-xs font-medium text-gray-600">
              {item.label}
            </span>
          </div>
          <div className={`text-lg font-bold text-${item.color}-600`}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VoteCard;