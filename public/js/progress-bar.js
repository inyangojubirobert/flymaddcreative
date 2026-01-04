// ========================================
// ONE DREAM PROGRESS BAR SYSTEM
// Tracks votes with milestone stages
// Goal: 1,000,000 votes
// Supports both hardcoded and database-driven milestones
// ========================================

(function() {
    'use strict';

    // ----------------------------------------
    // MILESTONE CONFIGURATION (DEFAULTS)
    // These are used as fallbacks if database fetch fails
    // ----------------------------------------
    const GOAL_VOTES = 1000000; // 1 Million votes target

    // Default individual user milestone stages
    let USER_MILESTONES = [
        { name: 'Bronze', minVotes: 0, maxVotes: 99, color: '#CD7F32', icon: '🥉', stage: 'bronze' },
        { name: 'Silver', minVotes: 100, maxVotes: 499, color: '#C0C0C0', icon: '🥈', stage: 'silver' },
        { name: 'Gold', minVotes: 500, maxVotes: 979, color: '#FFD700', icon: '🥇', stage: 'gold' },
        { name: 'Platinum', minVotes: 980, maxVotes: 4999, color: '#E5E4E2', icon: '💎', stage: 'platinum' },
        { name: 'Diamond', minVotes: 5000, maxVotes: Infinity, color: '#B9F2FF', icon: '👑', stage: 'diamond' }
    ];

    // Default global campaign milestones
    let CAMPAIGN_MILESTONES = [
        { votes: 10000, label: '10K', reward: 'Community Goal 1' },
        { votes: 50000, label: '50K', reward: 'Community Goal 2' },
        { votes: 100000, label: '100K', reward: 'Bronze Celebration' },
        { votes: 250000, label: '250K', reward: 'Silver Celebration' },
        { votes: 500000, label: '500K', reward: 'Gold Celebration' },
        { votes: 750000, label: '750K', reward: 'Platinum Celebration' },
        { votes: 1000000, label: '1M', reward: '🎉 GOAL REACHED!' }
    ];

    // Track if milestones were loaded from database
    let milestonesLoadedFromDB = false;

    // ----------------------------------------
    // FETCH MILESTONES FROM DATABASE
    // ----------------------------------------
    async function loadMilestonesFromAPI() {
        try {
            const response = await fetch('/api/onedream/milestones');
            if (!response.ok) throw new Error('API request failed');
            
            const data = await response.json();
            if (!data.success || !data.milestones?.length) {
                console.log('📊 Using default milestones (no DB data)');
                return false;
            }

            // Separate user stages from campaign milestones
            const userStages = data.milestones.filter(m => 
                ['bronze', 'silver', 'gold', 'platinum', 'diamond'].includes(m.stage?.toLowerCase())
            );
            
            const campaignMilestones = data.milestones.filter(m => 
                m.stage?.toLowerCase() === 'campaign'
            );

            // Update USER_MILESTONES if we have user stage data
            if (userStages.length > 0) {
                // Sort by vote threshold
                userStages.sort((a, b) => a.voteThreshold - b.voteThreshold);
                
                USER_MILESTONES = userStages.map((m, index, arr) => ({
                    name: m.name,
                    minVotes: m.voteThreshold,
                    maxVotes: arr[index + 1] ? arr[index + 1].voteThreshold - 1 : Infinity,
                    color: getStageColor(m.stage),
                    icon: m.icon || getDefaultIcon(m.stage),
                    stage: m.stage,
                    reward: m.reward
                }));
            }

            // Update CAMPAIGN_MILESTONES if we have campaign data
            if (campaignMilestones.length > 0) {
                campaignMilestones.sort((a, b) => a.voteThreshold - b.voteThreshold);
                
                CAMPAIGN_MILESTONES = campaignMilestones.map(m => ({
                    votes: m.voteThreshold,
                    label: formatVoteLabel(m.voteThreshold),
                    reward: m.reward || m.name
                }));
            }

            milestonesLoadedFromDB = true;
            console.log('✅ Milestones loaded from database');
            return true;

        } catch (error) {
            console.log('📊 Using default milestones (API error):', error.message);
            return false;
        }
    }

    function getStageColor(stage) {
        const colors = {
            bronze: '#CD7F32',
            silver: '#C0C0C0',
            gold: '#FFD700',
            platinum: '#E5E4E2',
            diamond: '#B9F2FF'
        };
        return colors[stage?.toLowerCase()] || '#CD7F32';
    }

    function getDefaultIcon(stage) {
        const icons = {
            bronze: '🥉',
            silver: '🥈',
            gold: '🥇',
            platinum: '💎',
            diamond: '👑'
        };
        return icons[stage?.toLowerCase()] || '🏆';
    }

    function formatVoteLabel(votes) {
        if (votes >= 1000000) return `${votes / 1000000}M`;
        if (votes >= 1000) return `${votes / 1000}K`;
        return votes.toString();
    }

    // ----------------------------------------
    // HELPER FUNCTIONS
    // ----------------------------------------

    /**
     * Get user's current stage based on votes
     */
    function getUserStage(votes) {
        for (const stage of USER_MILESTONES) {
            if (votes >= stage.minVotes && votes <= stage.maxVotes) {
                return stage;
            }
        }
        return USER_MILESTONES[USER_MILESTONES.length - 1]; // Diamond
    }

    /**
     * Get next milestone for user
     */
    function getNextMilestone(votes) {
        for (const stage of USER_MILESTONES) {
            if (votes < stage.maxVotes && stage.maxVotes !== Infinity) {
                return {
                    name: stage.name,
                    votesNeeded: stage.maxVotes + 1,
                    remaining: stage.maxVotes + 1 - votes
                };
            }
        }
        return null; // Already at Diamond
    }

    /**
     * Calculate progress percentage within current stage
     */
    function getStageProgress(votes) {
        const stage = getUserStage(votes);
        if (stage.maxVotes === Infinity) return 100; // Diamond stage
        
        const stageRange = stage.maxVotes - stage.minVotes + 1;
        const progressInStage = votes - stage.minVotes;
        return Math.min((progressInStage / stageRange) * 100, 100);
    }

    /**
     * Format number with commas
     */
    function formatNumber(num) {
        return num.toLocaleString();
    }

    // ----------------------------------------
    // PROGRESS BAR RENDERERS
    // ----------------------------------------

    /**
     * Create User Stage Progress Bar HTML
     * Shows individual user's progress toward next milestone
     */
    function createUserProgressBar(votes, options = {}) {
        const {
            showMilestones = true,
            showValue = true,
            animate = true
        } = options;

        const stage = getUserStage(votes);
        const nextMilestone = getNextMilestone(votes);
        const stageProgress = getStageProgress(votes);

        let nextStageInfo = '';
        if (nextMilestone) {
            nextStageInfo = `
                <div class="text-xs text-slate-400 mt-2">
                    ${nextMilestone.remaining} more votes to reach ${nextMilestone.name} stage
                </div>
            `;
        } else {
            nextStageInfo = `
                <div class="text-xs text-yellow-400 mt-2">
                    👑 You've reached the highest stage!
                </div>
            `;
        }

        const html = `
            <div class="progress-bar-container user-progress">
                <div class="flex justify-between items-center mb-2">
                    <div class="flex items-center gap-2">
                        <span class="text-lg">${stage.icon}</span>
                        <span class="font-medium text-white">${stage.name} Stage</span>
                    </div>
                    ${showValue ? `<span class="text-sm text-slate-300">${formatNumber(votes)} votes</span>` : ''}
                </div>
                
                <div class="relative h-4 bg-slate-700 rounded-full overflow-hidden">
                    <div class="progress-fill h-full rounded-full transition-all duration-1000 ease-out ${animate ? 'animate-progress' : ''}"
                         style="width: ${stageProgress}%; background: linear-gradient(90deg, ${stage.color}, ${stage.color}dd);">
                        <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                    </div>
                </div>
                
                ${showMilestones ? `
                    <div class="flex justify-between mt-2">
                        ${USER_MILESTONES.map(m => `
                            <div class="text-center">
                                <div class="text-xs ${votes >= m.minVotes ? 'text-white' : 'text-slate-500'}">${m.icon}</div>
                                <div class="text-xs ${votes >= m.minVotes ? 'text-slate-300' : 'text-slate-600'}">${m.name}</div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                ${nextStageInfo}
            </div>
        `;

        return html;
    }

    /**
     * Create Campaign Progress Bar HTML
     * Shows global progress toward 1 million votes
     */
    function createCampaignProgressBar(totalVotes, options = {}) {
        const {
            showMilestones = true,
            showValue = true,
            animate = true
        } = options;

        const percentage = Math.min((totalVotes / GOAL_VOTES) * 100, 100);
        
        // Find current and next milestone
        let currentMilestone = CAMPAIGN_MILESTONES[0];
        let nextMilestone = CAMPAIGN_MILESTONES[0];
        
        for (let i = 0; i < CAMPAIGN_MILESTONES.length; i++) {
            if (totalVotes >= CAMPAIGN_MILESTONES[i].votes) {
                currentMilestone = CAMPAIGN_MILESTONES[i];
                nextMilestone = CAMPAIGN_MILESTONES[i + 1] || currentMilestone;
            }
        }

        const milestonesHtml = showMilestones ? `
            <div class="relative h-6 mt-4">
                ${CAMPAIGN_MILESTONES.map(m => {
                    const pos = (m.votes / GOAL_VOTES) * 100;
                    const reached = totalVotes >= m.votes;
                    return `
                        <div class="absolute transform -translate-x-1/2" style="left: ${pos}%">
                            <div class="w-2 h-2 rounded-full ${reached ? 'bg-yellow-400' : 'bg-slate-600'}"></div>
                            <div class="text-xs mt-1 ${reached ? 'text-yellow-400' : 'text-slate-500'} whitespace-nowrap">${m.label}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : '';

        const html = `
            <div class="progress-bar-container campaign-progress">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-medium text-white">🌟 Journey to 1 Million Votes</span>
                    ${showValue ? `<span class="text-sm text-yellow-400">${formatNumber(totalVotes)} / ${formatNumber(GOAL_VOTES)}</span>` : ''}
                </div>
                
                <div class="relative h-6 bg-slate-700 rounded-full overflow-hidden">
                    <div class="progress-fill h-full rounded-full transition-all duration-1000 ease-out ${animate ? 'animate-progress' : ''}"
                         style="width: ${percentage}%; background: linear-gradient(90deg, #FFD700, #FFA500, #FF6B35);">
                        <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                    </div>
                    
                    <!-- Percentage inside bar -->
                    <div class="absolute inset-0 flex items-center justify-center">
                        <span class="text-xs font-bold text-white drop-shadow-lg">${percentage.toFixed(2)}%</span>
                    </div>
                </div>
                
                ${milestonesHtml}
                
                ${nextMilestone && totalVotes < GOAL_VOTES ? `
                    <div class="text-sm text-slate-400 mt-3">
                        Next milestone: <span class="text-yellow-400">${nextMilestone.label}</span> 
                        (${formatNumber(nextMilestone.votes - totalVotes)} votes away)
                    </div>
                ` : totalVotes >= GOAL_VOTES ? `
                    <div class="text-lg text-yellow-400 font-bold mt-3 text-center">
                        🎉 GOAL REACHED! 1 MILLION VOTES! 🎉
                    </div>
                ` : ''}
            </div>
        `;

        return html;
    }

    /**
     * Create Mini Progress Badge
     * Compact version for cards/lists
     */
    function createProgressBadge(votes) {
        const stage = getUserStage(votes);
        return `
            <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium"
                  style="background: ${stage.color}20; color: ${stage.color}; border: 1px solid ${stage.color}50;">
                ${stage.icon} ${stage.name}
            </span>
        `;
    }

    // ----------------------------------------
    // DOM HELPERS
    // ----------------------------------------

    /**
     * Render progress bar to a container element
     */
    function renderUserProgress(containerId, votes, options = {}) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = createUserProgressBar(votes, options);
        }
    }

    function renderCampaignProgress(containerId, totalVotes, options = {}) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = createCampaignProgressBar(totalVotes, options);
        }
    }

    /**
     * Fetch synchronized vote stats from the API
     * This reads from votes table and syncs with milestones
     */
    async function fetchVoteStats() {
        try {
            const response = await fetch('/api/onedream/vote-stats');
            if (!response.ok) throw new Error('Failed to fetch vote stats');
            
            const data = await response.json();
            if (!data.success) throw new Error(data.error);
            
            return data;
        } catch (error) {
            console.error('Error fetching vote stats:', error);
            return null;
        }
    }

    /**
     * Auto-update progress bars with real-time data from vote-stats API
     * This syncs milestones with actual vote data
     */
    async function updateProgressBars() {
        try {
            // First try to get synchronized stats from API
            const stats = await fetchVoteStats();
            
            if (stats) {
                // Update campaign progress with synced data
                const campaignEl = document.getElementById('campaignProgress');
                if (campaignEl) {
                    renderCampaignProgress('campaignProgress', stats.stats.totalVotes);
                }

                // Update milestone display if it exists
                const milestoneEl = document.getElementById('milestoneInfo');
                if (milestoneEl && stats.milestones.next) {
                    milestoneEl.innerHTML = `
                        <div class="text-sm text-slate-400">
                            Next: <span class="text-yellow-400">${stats.milestones.next.icon} ${stats.milestones.next.name}</span>
                            - ${formatNumber(stats.milestones.next.votesNeeded)} votes away
                        </div>
                    `;
                }

                // Update stage distribution if displayed
                const stageDistEl = document.getElementById('stageDistribution');
                if (stageDistEl && stats.stageDistribution) {
                    const dist = stats.stageDistribution;
                    stageDistEl.innerHTML = `
                        <div class="flex gap-2 text-xs">
                            <span>🥉 ${dist.bronze}</span>
                            <span>🥈 ${dist.silver}</span>
                            <span>🥇 ${dist.gold}</span>
                            <span>💎 ${dist.platinum}</span>
                            <span>👑 ${dist.diamond}</span>
                        </div>
                    `;
                }

                return stats;
            }

            // Fallback to SupabaseAPI if vote-stats fails
            const campaignEl = document.getElementById('campaignProgress');
            if (campaignEl && window.SupabaseAPI) {
                const leaderboard = await window.SupabaseAPI.getLeaderboard(1000);
                const totalVotes = leaderboard.reduce((sum, p) => sum + (p.total_votes || 0), 0);
                renderCampaignProgress('campaignProgress', totalVotes);
            }

            // Update user progress if element exists
            const userEl = document.getElementById('userProgress');
            if (userEl) {
                const savedUser = localStorage.getItem('onedream_user');
                if (savedUser && window.SupabaseAPI) {
                    const user = JSON.parse(savedUser);
                    const participant = await window.SupabaseAPI.getParticipantByUsername(user.username);
                    if (participant) {
                        renderUserProgress('userProgress', participant.total_votes || 0);
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error updating progress bars:', error);
            return null;
        }
    }

    /**
     * Format number with commas
     */
    function formatNumber(num) {
        return num.toLocaleString();
    }

    // ----------------------------------------
    // INJECT CSS STYLES
    // ----------------------------------------
    function injectStyles() {
        if (document.getElementById('progress-bar-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'progress-bar-styles';
        style.textContent = `
            .progress-bar-container {
                padding: 1rem;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 1rem;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .progress-fill {
                position: relative;
                overflow: hidden;
            }
            
            @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
            
            .animate-shimmer {
                animation: shimmer 2s infinite;
            }
            
            .animate-progress {
                animation: growWidth 1s ease-out;
            }
            
            @keyframes growWidth {
                from { width: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    // ----------------------------------------
    // EXPORT GLOBAL API
    // ----------------------------------------
    window.OneDreamProgress = {
        // Configuration (getters to ensure updated values)
        get GOAL_VOTES() { return GOAL_VOTES; },
        get USER_MILESTONES() { return USER_MILESTONES; },
        get CAMPAIGN_MILESTONES() { return CAMPAIGN_MILESTONES; },
        get milestonesFromDB() { return milestonesLoadedFromDB; },
        
        // Functions
        getUserStage,
        getNextMilestone,
        getStageProgress,
        loadMilestonesFromAPI,
        fetchVoteStats,
        
        // Renderers
        createUserProgressBar,
        createCampaignProgressBar,
        createProgressBadge,
        
        // DOM helpers
        renderUserProgress,
        renderCampaignProgress,
        updateProgressBars,
        
        // Initialize with DB milestones and sync vote data
        async init() {
            await loadMilestonesFromAPI();
            const stats = await fetchVoteStats();
            if (stats) {
                console.log('📊 Vote stats synced:', stats.stats.totalVotes, 'total votes');
            }
            return this;
        }
    };

    // Initialize styles
    injectStyles();
    
    // Auto-load milestones from DB on script load
    loadMilestonesFromAPI();
    
    console.log('✅ One Dream Progress Bar loaded');
    console.log('📊 Goal:', formatNumber(GOAL_VOTES), 'votes');
    console.log('🏆 Stages:', USER_MILESTONES.map(s => s.name).join(' → '));

})();
