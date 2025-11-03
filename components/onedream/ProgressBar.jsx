import { useState, useEffect } from 'react';

/**
 * Animated progress bar component for One Dream Initiative
 * Shows progress toward GOAL_VOTES and individual user progress
 */
const ProgressBar = ({ 
  current = 0, 
  target = 1000000, 
  label = "Progress", 
  showPercentage = true,
  showValues = true,
  className = "",
  animate = true 
}) => {
  const [displayCurrent, setDisplayCurrent] = useState(0);
  
  // Animate the progress bar on mount
  useEffect(() => {
    if (animate) {
      const timer = setTimeout(() => {
        setDisplayCurrent(current);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setDisplayCurrent(current);
    }
  }, [current, animate]);

  const percentage = Math.min((displayCurrent / target) * 100, 100);
  const formattedCurrent = displayCurrent.toLocaleString();
  const formattedTarget = target.toLocaleString();

  return (
    <div className={`w-full ${className}`}>
      {/* Label and values */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-700">
          {label}
        </span>
        {showValues && (
          <span className="text-sm text-gray-500">
            {formattedCurrent} / {formattedTarget}
          </span>
        )}
      </div>

      {/* Progress bar container */}
      <div className="w-full bg-gray-200 rounded-full h-4 relative overflow-hidden">
        {/* Progress fill */}
        <div
          className="h-full bg-gradient-to-r from-blue-600 to-blue-500 rounded-full transition-all duration-1000 ease-out relative"
          style={{ width: `${percentage}%` }}
        >
          {/* Shine effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 -skew-x-12 animate-pulse"></div>
        </div>
        
        {/* Percentage overlay */}
        {showPercentage && percentage > 10 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-white drop-shadow-sm">
              {percentage.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Percentage below bar (when percentage is too small to show inside) */}
      {showPercentage && percentage <= 10 && (
        <div className="text-right mt-1">
          <span className="text-xs text-gray-600">
            {percentage.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Milestone progress bar with markers
 * Shows key milestones along the journey to goal
 */
export const MilestoneProgressBar = ({ 
  current = 0, 
  target = 1000000,
  className = "" 
}) => {
  // Define milestone markers (percentages of target)
  const milestones = [
    { percent: 10, label: '100K' },
    { percent: 25, label: '250K' },
    { percent: 50, label: '500K' },
    { percent: 75, label: '750K' },
    { percent: 100, label: '1M' }
  ];

  const currentPercent = Math.min((current / target) * 100, 100);

  return (
    <div className={`w-full ${className}`}>
      <div className="text-sm font-medium text-gray-700 mb-2">
        Journey to 1 Million Votes
      </div>
      
      {/* Progress bar with milestones */}
      <div className="relative">
        {/* Base progress bar */}
        <ProgressBar 
          current={current}
          target={target}
          showPercentage={false}
          showValues={false}
          className="mb-4"
        />
        
        {/* Milestone markers */}
        <div className="absolute top-0 w-full h-4 pointer-events-none">
          {milestones.map((milestone, index) => (
            <div
              key={index}
              className="absolute top-0 h-full flex flex-col items-center"
              style={{ left: `${milestone.percent}%` }}
            >
              {/* Milestone line */}
              <div 
                className={`w-0.5 h-full ${
                  currentPercent >= milestone.percent 
                    ? 'bg-yellow-400' 
                    : 'bg-gray-400'
                }`}
              ></div>
              
              {/* Milestone label */}
              <div className="mt-1 text-xs font-medium text-gray-600 transform -translate-x-1/2">
                {milestone.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * User rank progress bar
 * Shows progress toward next rank or milestone
 */
export const UserRankBar = ({ 
  userVotes = 0, 
  nextMilestone = 1000,
  rank = 0,
  className = "" 
}) => {
  return (
    <div className={`bg-white rounded-lg p-4 border ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-700">
          Your Rank: #{rank}
        </span>
        <span className="text-sm text-blue-600 font-medium">
          {userVotes.toLocaleString()} votes
        </span>
      </div>
      
      <ProgressBar
        current={userVotes}
        target={nextMilestone}
        label={`Next milestone: ${nextMilestone.toLocaleString()} votes`}
        showPercentage={true}
        showValues={false}
        className="text-sm"
      />
      
      <div className="mt-2 text-xs text-gray-500">
        ${(userVotes * 2).toLocaleString()} equivalent value
      </div>
    </div>
  );
};

export default ProgressBar;