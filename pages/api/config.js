/**
 * 🔐 Secure Config API Endpoint
 * Returns only PUBLIC configuration needed for frontend
 * Never returns private keys or wallet addresses (backend handles those)
 */

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Only return PUBLIC keys - no hardcoded fallbacks, no wallet addresses
    const config = {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      environment: process.env.NODE_ENV || 'development',
      
      // Payment gateway PUBLIC keys only (from environment variables)
      paystack: {
        publicKey: process.env.PAYSTACK_PUBLIC_KEY
      },
      flutterwave: {
        publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY
      },
      walletconnect: {
        projectId: process.env.WALLETCONNECT_PROJECT_ID
      },
      crypto: {
        networks: ['bsc', 'tron'],
        chainId: 56
        // Wallet addresses handled by backend only
      }
    };

    // Validate required fields
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.error('Missing required Supabase environment variables');
      return res.status(500).json({ 
        error: 'Configuration not available',
        details: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY'
      });
    }

    // Set security headers
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.status(200).json(config);
  } catch (error) {
    console.error('Config API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to load configuration'
    });
  }
}