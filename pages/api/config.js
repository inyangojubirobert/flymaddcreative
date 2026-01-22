/**
 * 🔐 Secure Config API Endpoint
 * Returns only PUBLIC configuration needed for frontend
 * Never returns private keys or wallet addresses (backend handles those)
 */

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const config = {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',

      paystack: { publicKey: process.env.PAYSTACK_PUBLIC_KEY },
      walletconnect: { projectId: process.env.WALLETCONNECT_PROJECT_ID },
      crypto: { networks: ['bsc', 'tron'], chainId: 56 }
    };

    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.error('Missing required Supabase env vars');
      return res.status(500).json({ error: 'Configuration not available', details: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });
    }

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).json(config);

  } catch (error) {
    console.error('Config API error:', error);
    res.status(500).json({ error: 'Internal server error', message: 'Failed to load configuration' });
  }
}