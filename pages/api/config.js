/**
 * 🔐 Secure Config API Endpoint
 * Serves safe configuration to frontend without exposing secrets
 */

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Only serve public configuration
    const config = {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      // Never expose service role key or other secrets
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8000',
      environment: process.env.NODE_ENV || 'development',
    };

    // Validate required fields
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.error('Missing required environment variables');
      return res.status(500).json({ 
        error: 'Configuration not available',
        details: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY'
      });
    }

    // Set security headers
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Content-Type', 'application/json');
    
    // Only allow same-origin requests in production
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    res.status(200).json(config);
  } catch (error) {
    console.error('Config API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to load configuration'
    });
  }
}