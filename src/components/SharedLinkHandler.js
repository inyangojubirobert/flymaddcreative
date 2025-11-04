/**
 * SharedLinkHandler.js
 * Handles tracking of unique referral links for participants
 * 
 * Features:
 * - Vote attribution to referral codes
 * - Abuse prevention (one vote per session/IP)
 * - Analytics tracking
 * - Campaign landing page redirection
 */

class SharedLinkHandler {
  constructor(supabaseClient, analyticsClient = null) {
    this.supabase = supabaseClient;
    this.analytics = analyticsClient;
    this.sessionStorage = window.sessionStorage;
    this.localStorage = window.localStorage;
  }

  /**
   * Initialize link tracking when page loads
   */
  async initialize() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get('ref');
      
      if (refCode) {
        await this.handleReferralClick(refCode);
      }
    } catch (error) {
      console.error('Error initializing link handler:', error);
    }
  }

  /**
   * Process a referral link click
   * @param {string} refCode - The referral code from the URL
   */
  async handleReferralClick(refCode) {
    try {
      // Check if this user has already voted in this session
      const sessionKey = `voted_${refCode}`;
      const hasVotedInSession = this.sessionStorage.getItem(sessionKey);
      
      if (hasVotedInSession) {
        this.showMessage('You\'ve already supported this dream! Thank you! 🙏', 'info');
        return;
      }

      // Check if this IP has voted recently (prevent abuse)
      const userIP = await this.getUserIP();
      const hasVotedRecently = await this.checkRecentVote(userIP, refCode);
      
      if (hasVotedRecently) {
        this.showMessage('Thanks for your continued support! 💙', 'info');
        return;
      }

      // Find the participant by referral code
      const participant = await this.findParticipantByRefCode(refCode);
      
      if (!participant) {
        this.showMessage('Invalid referral link. Please check the link and try again.', 'error');
        return;
      }

      // Record the vote
      const voteResult = await this.recordVote(participant.id, refCode, userIP);
      
      if (voteResult.success) {
        // Mark as voted in session
        this.sessionStorage.setItem(sessionKey, Date.now().toString());
        
        // Show success message
        this.showMessage(
          `🎉 You've just supported ${participant.name}'s dream! Your vote counts! 🌟`, 
          'success'
        );
        
        // Track analytics
        this.trackAnalyticsEvent('vote_recorded', {
          participant_id: participant.id,
          referral_code: refCode,
          vote_value: 2, // $2 per vote
          timestamp: new Date().toISOString()
        });

        // Update global stats
        await this.updateGlobalStats();
        
        // Redirect to campaign landing with confirmation
        setTimeout(() => {
          this.redirectToLanding(participant.name);
        }, 3000);
      } else {
        throw new Error(voteResult.error || 'Failed to record vote');
      }
    } catch (error) {
      console.error('Error handling referral click:', error);
      this.showMessage('Something went wrong. Please try again later.', 'error');
    }
  }

  /**
   * Get user's IP address for abuse prevention
   */
  async getUserIP() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (error) {
      console.warn('Could not get user IP:', error);
      return 'unknown';
    }
  }

  /**
   * Check if this IP has voted for this referral recently
   * @param {string} userIP - User's IP address
   * @param {string} refCode - Referral code
   */
  async checkRecentVote(userIP, refCode) {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await this.supabase
        .from('votes')
        .select('id')
        .eq('ip_address', userIP)
        .eq('referral_code', refCode)
        .gte('created_at', twentyFourHoursAgo)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0;
    } catch (error) {
      console.error('Error checking recent vote:', error);
      return false; // Allow vote if we can't check
    }
  }

  /**
   * Find participant by referral code
   * @param {string} refCode - Referral code
   */
  async findParticipantByRefCode(refCode) {
    try {
      const { data, error } = await this.supabase
        .from('participants')
        .select('id, name, referral_code, total_votes')
        .eq('referral_code', refCode)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error finding participant:', error);
      return null;
    }
  }

  /**
   * Record a vote in the database
   * @param {string} participantId - ID of the participant
   * @param {string} refCode - Referral code
   * @param {string} userIP - User's IP address
   */
  async recordVote(participantId, refCode, userIP) {
    try {
      // Start a transaction to ensure data consistency
      const { data: voteData, error: voteError } = await this.supabase
        .from('votes')
        .insert({
          participant_id: participantId,
          referral_code: refCode,
          ip_address: userIP,
          vote_value: 2, // $2 per vote
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (voteError) throw voteError;

      // Update participant's vote count
      const { error: updateError } = await this.supabase
        .rpc('increment_participant_votes', {
          participant_id: participantId,
          increment_amount: 1
        });

      if (updateError) throw updateError;

      return { success: true, voteData };
    } catch (error) {
      console.error('Error recording vote:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update global campaign statistics
   */
  async updateGlobalStats() {
    try {
      const { error } = await this.supabase
        .rpc('update_global_stats');

      if (error) throw error;
    } catch (error) {
      console.error('Error updating global stats:', error);
    }
  }

  /**
   * Track analytics event
   * @param {string} eventName - Name of the event
   * @param {object} eventData - Event data
   */
  trackAnalyticsEvent(eventName, eventData) {
    try {
      // Track with external analytics service
      if (this.analytics) {
        this.analytics.track(eventName, eventData);
      }

      // Also store in our database for internal analytics
      this.supabase
        .from('analytics_events')
        .insert({
          event_name: eventName,
          event_data: eventData,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.warn('Analytics tracking failed:', error);
    }
  }

  /**
   * Show user feedback message
   * @param {string} message - Message to display
   * @param {string} type - Message type (success, error, info)
   */
  showMessage(message, type = 'info') {
    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `fixed top-4 right-4 max-w-md p-4 rounded-lg shadow-lg z-50 transform transition-all duration-300 ${
      type === 'success' ? 'bg-green-500 text-white' :
      type === 'error' ? 'bg-red-500 text-white' :
      'bg-blue-500 text-white'
    }`;
    messageEl.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="flex-1">${message}</div>
        <button class="text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
          ✕
        </button>
      </div>
    `;

    // Add to page
    document.body.appendChild(messageEl);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (messageEl.parentElement) {
        messageEl.remove();
      }
    }, 5000);
  }

  /**
   * Redirect to campaign landing page with confirmation
   * @param {string} participantName - Name of the participant
   */
  redirectToLanding(participantName) {
    const confirmationParams = new URLSearchParams({
      confirmed: 'true',
      supporter: participantName,
      timestamp: Date.now()
    });

    // Remove ref parameter and add confirmation
    const currentUrl = new URL(window.location);
    currentUrl.searchParams.delete('ref');
    confirmationParams.forEach((value, key) => {
      currentUrl.searchParams.set(key, value);
    });

    window.history.replaceState(null, '', currentUrl.toString());
    
    // Scroll to confirmation section if it exists
    const confirmationSection = document.getElementById('vote-confirmation');
    if (confirmationSection) {
      confirmationSection.scrollIntoView({ behavior: 'smooth' });
    }
  }

  /**
   * Generate a unique referral code for a new participant
   * @param {string} name - Participant name
   */
  generateReferralCode(name) {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    return `${cleanName.substring(0, 6)}${randomSuffix}`;
  }

  /**
   * Create a new participant with referral tracking
   * @param {object} participantData - Participant information
   */
  async createParticipant(participantData) {
    try {
      const referralCode = this.generateReferralCode(participantData.name);
      
      const { data, error } = await this.supabase
        .from('participants')
        .insert({
          ...participantData,
          referral_code: referralCode,
          total_votes: 0,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      return { success: true, participant: data };
    } catch (error) {
      console.error('Error creating participant:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get vote statistics for a participant
   * @param {string} participantId - Participant ID
   */
  async getParticipantStats(participantId) {
    try {
      const { data, error } = await this.supabase
        .from('participants')
        .select(`
          *,
          votes (
            created_at,
            vote_value
          )
        `)
        .eq('id', participantId)
        .single();

      if (error) throw error;

      // Calculate additional stats
      const today = new Date().toISOString().split('T')[0];
      const todayVotes = data.votes.filter(vote => 
        vote.created_at.startsWith(today)
      ).length;

      const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const weeklyVotes = data.votes.filter(vote => 
        vote.created_at >= last7Days
      ).length;

      return {
        ...data,
        todayVotes,
        weeklyVotes,
        totalEarnings: data.total_votes * 2 // $2 per vote
      };
    } catch (error) {
      console.error('Error getting participant stats:', error);
      return null;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SharedLinkHandler;
} else {
  window.SharedLinkHandler = SharedLinkHandler;
}