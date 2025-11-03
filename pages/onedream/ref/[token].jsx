import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import VoteCard from '../../../components/onedream/VoteCard';
import ProgressBar from '../../../components/onedream/ProgressBar';

/**
 * Referral Landing Page - /onedream/ref/[token]
 * Records visit events and shows payment/support options
 * Attributes votes to the referral token owner
 */
export default function ReferralLanding() {
  const router = useRouter();
  const { token } = router.query;
  const [referrer, setReferrer] = useState(null);
  const [visitRecorded, setVisitRecorded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);

  // Record visit when page loads
  useEffect(() => {
    if (token && typeof token === 'string') {
      recordVisit(token);
    }
  }, [token]);

  // Record the visit and get referrer info
  const recordVisit = async (referralToken) => {
    try {
      setLoading(true);
      
      // First, try to record the visit
      const visitResponse = await fetch('/api/onedream/recordVisit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: referralToken,
          userAgent: navigator.userAgent,
          referrer: document.referrer
        }),
      });

      const visitData = await visitResponse.json();
      
      if (visitResponse.ok) {
        setVisitRecorded(visitData.voteAwarded);
        
        // Get referrer information (mock for now)
        setReferrer({
          name: visitData.userName || 'A Participant',
          bio: 'Working toward their dream in the One Dream Initiative',
          currentVotes: 1247,
          rank: 23
        });
      } else {
        setError(visitData.error || 'Failed to process visit');
      }
    } catch (err) {
      console.error('Visit recording error:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle vote/payment action
  const handleVoteAction = (amount) => {
    if (amount > 0) {
      // Redirect to payment processing
      alert(`Payment integration coming soon! You selected $${amount} (${Math.floor(amount / 2)} votes)`);
    } else {
      // Free vote already recorded on visit
      alert('Thank you for your support! Your visit vote has been recorded.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Recording your visit...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-yellow-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Invalid Link</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <Link href="/onedream">
            <a className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium">
              Visit One Dream Initiative
            </a>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Support {referrer?.name} - One Dream Initiative | FlyMadd Creative</title>
        <meta 
          name="description" 
          content={`Help ${referrer?.name} win the One Dream Initiative by voting through their referral link.`}
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        
        {/* Open Graph tags for social sharing */}
        <meta property="og:title" content={`Support ${referrer?.name} in the One Dream Initiative`} />
        <meta property="og:description" content="Help them win by voting through their unique link. Every vote counts!" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${process.env.NEXT_PUBLIC_SITE_URL}/onedream/ref/${token}`} />
        
        {/* Twitter Card tags */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`Support ${referrer?.name} in the One Dream Initiative`} />
        <meta name="twitter:description" content="Help them win by voting through their unique link. Every vote counts!" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-yellow-50">
        {/* Navigation */}
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link href="/onedream">
                <a className="text-blue-600 font-bold text-xl">One Dream Initiative</a>
              </Link>
              <div className="flex space-x-4">
                <Link href="/onedream/leaderboard">
                  <a className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                    Leaderboard
                  </a>
                </Link>
                <Link href="/onedream/register">
                  <a className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
                    Join Now
                  </a>
                </Link>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
          {/* Success Message */}
          {visitRecorded && (
            <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <h3 className="text-sm font-medium text-green-800">Vote Recorded!</h3>
                  <p className="text-sm text-green-700 mt-1">
                    Your visit has been counted as a vote for {referrer?.name}.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Help {referrer?.name} Win!
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              You've been invited to support {referrer?.name} in the One Dream Initiative. 
              Your support helps them climb the leaderboard and achieve their dreams.
            </p>
          </div>

          {/* Referrer Info Card */}
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Referrer Details */}
            <div className="bg-white rounded-xl p-8 shadow-lg border">
              <div className="text-center mb-6">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-white">
                    {referrer?.name?.charAt(0) || 'U'}
                  </span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900">{referrer?.name}</h2>
                <p className="text-sm text-blue-600 font-medium">Rank #{referrer?.rank}</p>
              </div>
              
              {referrer?.bio && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Their Dream:</h3>
                  <p className="text-gray-600 text-sm">{referrer.bio}</p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <div className="text-lg font-bold text-blue-600">{referrer?.currentVotes?.toLocaleString()}</div>
                  <div className="text-xs text-gray-600">Current Votes</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-green-600">${((referrer?.currentVotes || 0) * 2).toLocaleString()}</div>
                  <div className="text-xs text-gray-600">Equivalent Value</div>
                </div>
              </div>
            </div>

            {/* Progress Visualization */}
            <div className="bg-white rounded-xl p-8 shadow-lg border">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">
                Progress Toward Goal
              </h3>
              
              <ProgressBar
                current={referrer?.currentVotes || 0}
                target={1000000}
                label="Individual Progress"
                className="mb-6"
              />
              
              <div className="space-y-4 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Current Position:</span>
                  <span className="font-medium">#{referrer?.rank || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total Value:</span>
                  <span className="font-medium">${((referrer?.currentVotes || 0) * 2).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>To Goal:</span>
                  <span className="font-medium">{((1000000 - (referrer?.currentVotes || 0))).toLocaleString()} votes</span>
                </div>
              </div>
            </div>
          </div>

          {/* Support Options */}
          <div className="bg-white rounded-xl p-8 shadow-lg border mb-12">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                How You Can Help
              </h2>
              <p className="text-gray-600">
                Choose how you'd like to support {referrer?.name}. Every contribution counts!
              </p>
            </div>

            {/* Support Options Grid */}
            <div className="grid md:grid-cols-3 gap-6">
              {/* Free Support */}
              <div className="text-center p-6 border-2 border-green-200 rounded-lg hover:border-green-300 transition-colors">
                <div className="text-4xl mb-4">🎯</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Free Vote</h3>
                <p className="text-sm text-gray-600 mb-4">
                  {visitRecorded ? 'Already recorded!' : 'Your visit counts as 1 vote'}
                </p>
                <div className="text-2xl font-bold text-green-600 mb-4">FREE</div>
                <button 
                  onClick={() => handleVoteAction(0)}
                  disabled={visitRecorded}
                  className={`w-full py-2 px-4 rounded font-medium ${
                    visitRecorded 
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {visitRecorded ? 'Vote Recorded!' : 'Cast Free Vote'}
                </button>
              </div>

              {/* Small Contribution */}
              <div className="text-center p-6 border-2 border-blue-200 rounded-lg hover:border-blue-300 transition-colors">
                <div className="text-4xl mb-4">💙</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Support Vote</h3>
                <p className="text-sm text-gray-600 mb-4">
                  5 votes to boost their ranking
                </p>
                <div className="text-2xl font-bold text-blue-600 mb-4">$10</div>
                <button 
                  onClick={() => handleVoteAction(10)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded font-medium"
                >
                  Give 5 Votes
                </button>
              </div>

              {/* Power Contribution */}
              <div className="text-center p-6 border-2 border-yellow-200 rounded-lg hover:border-yellow-300 transition-colors">
                <div className="text-4xl mb-4">⭐</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Power Vote</h3>
                <p className="text-sm text-gray-600 mb-4">
                  25 votes for maximum impact
                </p>
                <div className="text-2xl font-bold text-yellow-600 mb-4">$50</div>
                <button 
                  onClick={() => handleVoteAction(50)}
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-4 rounded font-medium"
                >
                  Give 25 Votes
                </button>
              </div>
            </div>

            {/* Custom Amount */}
            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600 mb-4">
                Want to contribute a different amount? Each $2 = 1 vote
              </p>
              <button 
                onClick={() => setShowPaymentOptions(true)}
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                Choose Custom Amount →
              </button>
            </div>
          </div>

          {/* Learn More Section */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 text-white text-center">
            <h2 className="text-2xl font-bold mb-4">Join the One Dream Initiative</h2>
            <p className="text-blue-100 mb-6 max-w-2xl mx-auto">
              Create your own referral link and start earning votes for your dreams. 
              It's free to join and only takes 30 seconds!
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/onedream/register">
                <a className="bg-white text-blue-600 hover:bg-gray-50 px-6 py-3 rounded-lg font-medium inline-flex items-center justify-center">
                  Get Started Now
                  <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </a>
              </Link>
              <Link href="/onedream">
                <a className="border-2 border-white text-white hover:bg-white hover:text-blue-600 px-6 py-3 rounded-lg font-medium">
                  Learn More
                </a>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}