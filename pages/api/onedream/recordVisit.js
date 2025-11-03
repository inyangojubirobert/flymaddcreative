// Lightweight endpoint to record visit votes
// Called when someone visits a referral link
// Only records votes if ALLOW_FREE_VISITS_AS_VOTE is enabled

import { 
  getUserByReferralToken, 
  recordVote, 
  checkRateLimit,
  ALLOW_FREE_VISITS_AS_VOTE 
} from '../../../lib/onedreamHelpers';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - max 5 visits per IP per minute to prevent abuse
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(`visit_${clientIP}`, 5, 60 * 1000)) {
    return res.status(429).json({ 
      error: 'Too many visit attempts. Please slow down.' 
    });
  }

  const { token, userAgent, referrer } = req.body;

  // Validate required fields
  if (!token) {
    return res.status(400).json({ 
      error: 'Referral token is required' 
    });
  }

  // Check if free visits are allowed
  if (!ALLOW_FREE_VISITS_AS_VOTE) {
    return res.status(200).json({ 
      success: true,
      message: 'Visit recorded but votes not awarded (feature disabled)',
      voteAwarded: false
    });
  }

  try {
    // Find user by referral token
    const user = await getUserByReferralToken(token);
    if (!user) {
      return res.status(404).json({ 
        error: 'Invalid referral token' 
      });
    }

    // Additional rate limiting per user token
    if (!checkRateLimit(`visit_token_${token}`, 10, 60 * 60 * 1000)) { // 10 visits per hour per token
      return res.status(429).json({ 
        error: 'Visit limit reached for this link. Try again later.' 
      });
    }

    // Record the visit vote
    const voteRecord = await recordVote({
      userId: user.id,
      votes: 1,
      amountUsd: 0,
      source: 'visit'
    });

    // Log visit data for analytics (optional)
    await logVisitAnalytics({
      userId: user.id,
      userAgent,
      referrer,
      clientIP,
      timestamp: new Date().toISOString()
    });

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Visit recorded and vote awarded',
      voteAwarded: true,
      data: {
        votesAdded: 1,
        userName: user.name,
        totalVotesNeeded: 1000000
      }
    });

  } catch (error) {
    console.error('Visit recording error:', error);
    res.status(500).json({ 
      error: 'Failed to record visit. Please try again.' 
    });
  }
}

// Log visit analytics (can be stored in a separate table or external service)
async function logVisitAnalytics(visitData) {
  try {
    // In a real application, you might want to store this in a separate analytics table
    // or send to an analytics service like Google Analytics, Mixpanel, etc.
    
    console.log('Visit Analytics:', {
      userId: visitData.userId,
      timestamp: visitData.timestamp,
      userAgent: visitData.userAgent,
      referrer: visitData.referrer,
      ip: visitData.clientIP?.substring(0, 10) + '...' // Partial IP for privacy
    });

    // Example: Store in Supabase analytics table
    /*
    const { error } = await supabase
      .from('onedream_visit_analytics')
      .insert({
        user_id: visitData.userId,
        user_agent: visitData.userAgent,
        referrer: visitData.referrer,
        ip_hash: hashIP(visitData.clientIP), // Hash IP for privacy
        created_at: visitData.timestamp
      });
    */

  } catch (error) {
    console.error('Analytics logging error:', error);
    // Don't fail the main request if analytics fails
  }
}

// Helper function to hash IP addresses for privacy
function hashIP(ip) {
  // Simple hash function - in production use a proper crypto hash
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

// Middleware to validate visit requests
export function validateVisitRequest(req, res, next) {
  const { token } = req.body;
  
  if (!token || typeof token !== 'string' || token.length < 8) {
    return res.status(400).json({ 
      error: 'Invalid referral token format' 
    });
  }

  // Basic token sanitization
  req.body.token = token.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  
  next();
}