// Redirects to specific handlers based on path
export default function handler(req, res) {
    res.status(200).json({ 
        message: 'One Dream API',
        endpoints: [
            'POST /api/onedream/register',
            'POST /api/onedream/login',
            'POST /api/onedream/verify',
            'GET /api/onedream/participants/:username',
            'GET /api/onedream/participants/code/:code',
            'GET /api/onedream/leaderboard',
            'GET /api/onedream/search',
            'GET /api/onedream/health'
        ]
    });
}
