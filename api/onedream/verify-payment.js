/**
 * API Endpoint: Check payment verification status
 * Used to poll for payment confirmation
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        const { tx, hash, transaction_hash } = req.query;
        const txHash = tx || hash || transaction_hash;
        
        if (!txHash) {
            return res.status(400).json({ error: 'Transaction hash required' });
        }
        
        // Look up in database
        const { data: payment, error } = await supabase
            .from('payments')
            .select('*')
            .eq('transaction_hash', txHash)
            .single();
        
        if (error || !payment) {
            return res.status(404).json({ 
                found: false, 
                message: 'Payment not found in records' 
            });
        }
        
        return res.status(200).json({
            found: true,
            verified: payment.verified,
            status: payment.status,
            network: payment.network,
            amount: payment.amount,
            participant_id: payment.participant_id,
            vote_count: payment.vote_count,
            verified_at: payment.verified_at,
            created_at: payment.created_at
        });
        
    } catch (error) {
        console.error('[Verify] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
