import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'PATCH') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { id } = req.query;
    const { merchant_name, company_name, wallet_address } = req.body;

    try {
        const updates = {};
        if (merchant_name) updates.merchant_name = merchant_name.trim();
        if (company_name !== undefined) updates.company_name = company_name?.trim() || null;
        if (wallet_address !== undefined) updates.wallet_address = wallet_address?.trim() || null;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const { data: merchant, error } = await supabase
            .from('referral_merchants')
            .update(updates)
            .eq('id', id)
            .select('id, merchant_name, email, company_name, wallet_address')
            .single();

        if (error || !merchant) {
            return res.status(404).json({ success: false, error: 'Merchant not found' });
        }

        return res.status(200).json({ success: true, message: 'Profile updated', merchant });

    } catch (err) {
        console.error('Profile update error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
}
