import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import ProgressBar from '../../components/onedream/ProgressBar';

/**
 * One Dream Initiative Landing Page
 * Describes the vision, how to participate, prizes, and threshold explanation
 */
export default function OneDreamIndex() {
  const [stats, setStats] = useState({
    totalVotes: 247853,
    totalUsers: 1247,
    progressPercent: 24.79
  });

  return (
    <>
      <Head>
        <title>One Dream Initiative - Harnessing Support Through Social Influence | FlyMadd Creative</title>
        <meta 
          name="description" 
          content="Join the One Dream Initiative in partnership with FlyMadd Creative. Harness support through social influence, share your unique link, and compete for amazing prizes!" 
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Hero Section */}
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-yellow-50">
        {/* Navigation */}
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-4">
                <Link href="/">
                  <a className="text-blue-600 font-bold text-xl">FlyMadd Creative</a>
                </Link>
                <span className="text-gray-400">|</span>
                <h1 className="text-lg font-semibold text-gray-900">One Dream Initiative</h1>
              </div>
              <div className="flex space-x-4">
                <Link href="/onedream/login">
                  <a className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                    Login
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

        {/* Hero Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center">
            {/* Vision Statement */}
            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-6">
              One Dream Initiative
            </h1>
            <p className="text-xl md:text-2xl text-blue-600 mb-8 font-medium">
              Harnessing support through social influence
            </p>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto mb-12">
              In partnership with <strong>FlyMadd Creative</strong>, we're creating a movement where 
              your social influence translates into meaningful rewards. Share, vote, and win together.
            </p>

            {/* Current Progress */}
            <div className="max-w-2xl mx-auto mb-16">
              <ProgressBar
                current={stats.totalVotes}
                target={1000000}
                label="Global Progress to 1 Million Votes"
                className="mb-4"
              />
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <div className="text-2xl font-bold text-blue-600">{stats.totalVotes.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Votes</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">${(stats.totalVotes * 2).toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Value</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-purple-600">{stats.totalUsers.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Participants</div>
                </div>
              </div>
            </div>

            {/* CTA Button */}
            <Link href="/onedream/register">
              <a className="inline-flex items-center px-8 py-4 text-lg font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg shadow-lg transform hover:scale-105 transition-all duration-200">
                Start Your Journey
                <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </Link>
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              How It Works
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Three simple steps to start earning votes and climbing the leaderboard
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Step 1: Register */}
            <div className="text-center p-8 rounded-xl bg-blue-50 border border-blue-100">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">1. Register</h3>
              <p className="text-gray-600 mb-4">
                Create your account and get your unique referral link. It takes just 30 seconds to join.
              </p>
              <Link href="/onedream/register">
                <a className="text-blue-600 font-medium hover:text-blue-700">
                  Sign up now →
                </a>
              </Link>
            </div>

            {/* Step 2: Share */}
            <div className="text-center p-8 rounded-xl bg-yellow-50 border border-yellow-100">
              <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">2. Share</h3>
              <p className="text-gray-600 mb-4">
                Share your unique link on social media, with friends, or anyone who supports your dream.
              </p>
              <span className="text-yellow-600 font-medium">
                Every click counts →
              </span>
            </div>

            {/* Step 3: Earn Votes */}
            <div className="text-center p-8 rounded-xl bg-green-50 border border-green-100">
              <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">3. Earn Votes</h3>
              <p className="text-gray-600 mb-4">
                Get votes from visits and contributions. Each vote is valued at $2 toward your total.
              </p>
              <span className="text-green-600 font-medium">
                Climb the leaderboard →
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Prizes Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Amazing Prizes Await
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              When we reach 1,000,000 collective votes, the top winners receive these incredible prizes
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Grand Prize */}
            <div className="bg-gradient-to-br from-yellow-400 to-yellow-500 p-8 rounded-xl text-center text-white transform hover:scale-105 transition-transform">
              <div className="text-6xl mb-4">🏆</div>
              <h3 className="text-2xl font-bold mb-2">Grand Prize</h3>
              <div className="text-4xl font-bold mb-4">$1,000</div>
              <p className="text-yellow-100">
                For the participant with the highest total votes
              </p>
            </div>

            {/* Second Place */}
            <div className="bg-gradient-to-br from-gray-400 to-gray-500 p-8 rounded-xl text-center text-white transform hover:scale-105 transition-transform">
              <div className="text-6xl mb-4">🥈</div>
              <h3 className="text-2xl font-bold mb-2">Second Place</h3>
              <div className="text-4xl font-bold mb-4">$500</div>
              <p className="text-gray-100">
                For the runner-up champion
              </p>
            </div>

            {/* Third Place */}
            <div className="bg-gradient-to-br from-orange-400 to-orange-500 p-8 rounded-xl text-center text-white transform hover:scale-105 transition-transform">
              <div className="text-6xl mb-4">🥉</div>
              <h3 className="text-2xl font-bold mb-2">Third Place</h3>
              <div className="text-4xl font-bold mb-4">$200</div>
              <p className="text-orange-100">
                For the bronze medal winner
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Threshold Explanation */}
      <section className="py-20 bg-blue-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-8">
              The 1 Million Vote Threshold
            </h2>
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="text-left">
                <h3 className="text-2xl font-semibold mb-6">How the system works:</h3>
                <ul className="space-y-4 text-lg">
                  <li className="flex items-start space-x-3">
                    <svg className="w-6 h-6 text-yellow-400 mt-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Each vote is valued at exactly <strong>$2</strong></span>
                  </li>
                  <li className="flex items-start space-x-3">
                    <svg className="w-6 h-6 text-yellow-400 mt-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>A round concludes when we reach <strong>1,000,000 total votes</strong></span>
                  </li>
                  <li className="flex items-start space-x-3">
                    <svg className="w-6 h-6 text-yellow-400 mt-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>Winners are determined by <strong>highest individual vote counts</strong></span>
                  </li>
                  <li className="flex items-start space-x-3">
                    <svg className="w-6 h-6 text-yellow-400 mt-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>New rounds begin after each milestone</span>
                  </li>
                </ul>
              </div>
              <div className="bg-white bg-opacity-10 rounded-xl p-8">
                <h4 className="text-xl font-semibold mb-4">Current Status</h4>
                <div className="text-4xl font-bold text-yellow-400 mb-2">
                  {stats.progressPercent}%
                </div>
                <p className="text-blue-100 mb-4">Complete</p>
                <div className="text-sm text-blue-200">
                  {(1000000 - stats.totalVotes).toLocaleString()} votes remaining to reach the threshold
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-20 bg-gradient-to-r from-yellow-400 to-yellow-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to Make Your Dream Reality?
          </h2>
          <p className="text-xl text-yellow-100 mb-8">
            Join thousands of participants already sharing their dreams with the world.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/onedream/register">
              <a className="inline-flex items-center px-8 py-4 text-lg font-medium text-yellow-500 bg-white hover:bg-gray-50 rounded-lg shadow-lg transform hover:scale-105 transition-all duration-200">
                Join the Initiative
                <svg className="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </Link>
            <Link href="/onedream/leaderboard">
              <a className="inline-flex items-center px-8 py-4 text-lg font-medium text-white border-2 border-white hover:bg-white hover:text-yellow-500 rounded-lg transform hover:scale-105 transition-all duration-200">
                View Leaderboard
              </a>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-bold text-lg mb-4">One Dream Initiative</h3>
              <p className="text-gray-400 text-sm">
                In partnership with FlyMadd Creative, harnessing support through social influence.
              </p>
            </div>
            <div>
              <h4 className="font-medium mb-4">Quick Links</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/onedream/register"><a className="text-gray-400 hover:text-white">Register</a></Link></li>
                <li><Link href="/onedream/leaderboard"><a className="text-gray-400 hover:text-white">Leaderboard</a></Link></li>
                <li><Link href="/onedream/login"><a className="text-gray-400 hover:text-white">Login</a></Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">Support</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="text-gray-400 hover:text-white">Help Center</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Contact Us</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Terms of Service</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-4">FlyMadd Creative</h4>
              <ul className="space-y-2 text-sm">
                <li><Link href="/"><a className="text-gray-400 hover:text-white">Main Website</a></Link></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Portfolio</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Services</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-400 text-sm">
              © 2025 One Dream Initiative in partnership with FlyMadd Creative. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}