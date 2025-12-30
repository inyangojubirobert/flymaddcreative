import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ valid: false, error: 'No token' });
    }
    
    try {
        const token = auth.slice(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        res.status(200).json({ valid: true, userId: decoded.userId, email: decoded.email });
    } catch {
        res.status(401).json({ valid: false, error: 'Invalid token' });
    }
}
