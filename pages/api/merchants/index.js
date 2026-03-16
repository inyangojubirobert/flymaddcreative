// pages/api/merchants/index.js

// This endpoint exists so that /api/merchants (without a subpath) returns a 200.
// That helps health checks (HEAD/GET) used by frontend code.

export default function handler(req, res) {
  if (req.method === 'HEAD' || req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'Merchants API is available',
      route: '/api/merchants'
    });
  }

  res.setHeader('Allow', 'GET, HEAD');
  res.status(405).json({ success: false, message: 'Method not allowed' });
}
