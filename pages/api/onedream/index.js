// Redirects to specific handlers based on path
export default function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    res.status(200).json({ 
        message: 'One Dream API',
        version: '1.0.0',
        endpoints: [
            'POST /api/onedream/register',
            'POST /api/onedream/login',
            'POST /api/onedream/verify',
            'GET /api/onedream/participants/[username]',
            'GET /api/onedream/leaderboard',
            'GET /api/onedream/search',
            'GET /api/onedream/health'
        ]
    });
}
