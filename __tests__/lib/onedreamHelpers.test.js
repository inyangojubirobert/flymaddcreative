// __tests__/lib/onedreamHelpers.test.js
// Unit tests for One Dream Initiative helper functions

import {
  generateReferralToken,
  calcVotesFromAmount,
  generateShareUrls,
  checkRateLimit,
  VOTE_VALUE,
  GOAL_VOTES
} from '../../lib/onedreamHelpers';

describe('One Dream Initiative Helpers', () => {
  
  describe('generateReferralToken', () => {
    it('should generate a unique token for a user ID', () => {
      const userId = 'test-user-123';
      const token1 = generateReferralToken(userId);
      const token2 = generateReferralToken(userId);
      
      expect(token1).toBeDefined();
      expect(token2).toBeDefined();
      expect(token1).not.toBe(token2); // Should be unique each time
      expect(token1.length).toBeGreaterThan(8);
      expect(typeof token1).toBe('string');
    });
    
    it('should return lowercase alphanumeric tokens', () => {
      const userId = 'test-user-123';
      const token = generateReferralToken(userId);
      
      expect(token).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe('calcVotesFromAmount', () => {
    it('should calculate correct votes from amount', () => {
      expect(calcVotesFromAmount(10)).toBe(5); // $10 / $2 = 5 votes
      expect(calcVotesFromAmount(20)).toBe(10); // $20 / $2 = 10 votes
      expect(calcVotesFromAmount(100)).toBe(50); // $100 / $2 = 50 votes
    });
    
    it('should floor partial votes', () => {
      expect(calcVotesFromAmount(1)).toBe(0); // $1 / $2 = 0.5, floored to 0
      expect(calcVotesFromAmount(3)).toBe(1); // $3 / $2 = 1.5, floored to 1
      expect(calcVotesFromAmount(5)).toBe(2); // $5 / $2 = 2.5, floored to 2
    });
    
    it('should handle zero and negative amounts', () => {
      expect(calcVotesFromAmount(0)).toBe(0);
      expect(calcVotesFromAmount(-10)).toBe(-5); // Negative amounts return negative votes
    });
    
    it('should use the correct VOTE_VALUE constant', () => {
      expect(VOTE_VALUE).toBe(2);
      expect(calcVotesFromAmount(VOTE_VALUE)).toBe(1);
    });
  });

  describe('generateShareUrls', () => {
    const testUrl = 'https://example.com/onedream/ref/abc123';
    const testName = 'John Doe';
    
    it('should generate social media share URLs', () => {
      const urls = generateShareUrls(testUrl, testName);
      
      expect(urls).toHaveProperty('twitter');
      expect(urls).toHaveProperty('facebook');
      expect(urls).toHaveProperty('linkedin');
      expect(urls).toHaveProperty('whatsapp');
      expect(urls).toHaveProperty('email');
    });
    
    it('should include the referral URL in all share links', () => {
      const urls = generateShareUrls(testUrl, testName);
      
      Object.values(urls).forEach(url => {
        expect(url).toContain(encodeURIComponent(testUrl));
      });
    });
    
    it('should include the user name in share text', () => {
      const urls = generateShareUrls(testUrl, testName);
      
      expect(urls.twitter).toContain(encodeURIComponent(testName));
      expect(urls.email).toContain(testName);
    });
    
    it('should handle empty user name gracefully', () => {
      const urls = generateShareUrls(testUrl, '');
      
      expect(urls.twitter).toContain('me');
      expect(urls.email).toContain('me');
    });
  });

  describe('checkRateLimit', () => {
    beforeEach(() => {
      // Clear any existing rate limit data
      jest.clearAllMocks();
    });
    
    it('should allow requests within rate limit', () => {
      const key = 'test-key-1';
      const maxRequests = 5;
      const windowMs = 60000; // 1 minute
      
      // Should allow first 5 requests
      for (let i = 0; i < maxRequests; i++) {
        expect(checkRateLimit(key, maxRequests, windowMs)).toBe(true);
      }
    });
    
    it('should deny requests exceeding rate limit', () => {
      const key = 'test-key-2';
      const maxRequests = 3;
      const windowMs = 60000;
      
      // Allow first 3 requests
      for (let i = 0; i < maxRequests; i++) {
        expect(checkRateLimit(key, maxRequests, windowMs)).toBe(true);
      }
      
      // 4th request should be denied
      expect(checkRateLimit(key, maxRequests, windowMs)).toBe(false);
    });
    
    it('should use different limits for different keys', () => {
      const key1 = 'user-1';
      const key2 = 'user-2';
      const maxRequests = 2;
      const windowMs = 60000;
      
      // Each key should have its own limit
      expect(checkRateLimit(key1, maxRequests, windowMs)).toBe(true);
      expect(checkRateLimit(key2, maxRequests, windowMs)).toBe(true);
      expect(checkRateLimit(key1, maxRequests, windowMs)).toBe(true);
      expect(checkRateLimit(key2, maxRequests, windowMs)).toBe(true);
      
      // Both should be at limit now
      expect(checkRateLimit(key1, maxRequests, windowMs)).toBe(false);
      expect(checkRateLimit(key2, maxRequests, windowMs)).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have correct constant values', () => {
      expect(VOTE_VALUE).toBe(2);
      expect(GOAL_VOTES).toBe(1000000);
    });
  });
  
  // Integration test
  describe('Integration', () => {
    it('should work together for a complete voting flow', () => {
      const userId = 'integration-test-user';
      const paymentAmount = 50;
      
      // Generate referral token
      const token = generateReferralToken(userId);
      expect(token).toBeDefined();
      
      // Calculate votes from payment
      const votes = calcVotesFromAmount(paymentAmount);
      expect(votes).toBe(25); // $50 / $2 = 25 votes
      
      // Generate share URLs
      const referralUrl = `https://example.com/onedream/ref/${token}`;
      const shareUrls = generateShareUrls(referralUrl, 'Test User');
      expect(shareUrls.twitter).toContain(token);
      
      // Check rate limiting
      expect(checkRateLimit(`vote_${userId}`, 10, 60000)).toBe(true);
    });
  });
});