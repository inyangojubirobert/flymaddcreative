import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { id } = req.query;
    const { amount } = req.body;

    if (!amount || amount < 50) {
        return res.status(400).json({ success: false, error: 'Minimum withdrawal is 50 tokens' });
    }

    try {
        const { data: merchant } = await supabase
            .from('referral_merchants')
            .select('available_tokens, wallet_address')
            .eq('id', id)
            .single();

        if (!merchant) {
            return res.status(404).json({ success: false, error: 'Merchant not found' });
        }

        if ((merchant.available_tokens || 0) < amount) {
            return res.status(400).json({ success: false, error: 'Insufficient balance' });
        }

        await supabase
            .from('referral_merchants')
            .update({ available_tokens: merchant.available_tokens - amount })
            .eq('id', id);

        return res.status(200).json({
            success: true,
            message: 'Withdrawal request submitted',
            withdrawal: {
                amount,
                wallet: merchant.wallet_address,
                status: 'processing'
            }
        });

    } catch (err) {
        console.error('Withdrawal error:', err);
        return res.status(500).json({ success: false, error: 'Withdrawal failed' });
    }
}
