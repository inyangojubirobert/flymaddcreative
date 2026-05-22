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
    const { description } = req.body;

    try {
        const { data: merchant } = await supabase
            .from('referral_merchants')
            .select('merchant_name')
            .eq('id', id)
            .single();

        if (!merchant) {
            return res.status(404).json({ success: false, error: 'Merchant not found' });
        }

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online';
        const linkCode = 'MERCH-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const fullLink = `${baseUrl}/registration.html?ref=${linkCode}`;

        const { data: link, error } = await supabase
            .from('merchant_referral_links')
            .insert({
                merchant_id: id,
                link_code: linkCode,
                full_link: fullLink,
                description: description?.trim() || `Referral link for ${merchant.merchant_name}`,
                is_active: true,
                clicks_count: 0,
                registrations_count: 0
            })
            .select('id, link_code, full_link, description, is_active, created_at')
            .single();

        if (error) throw error;

        return res.status(201).json({ success: true, message: 'Referral link created', link });

    } catch (err) {
        console.error('Create link error:', err);
        return res.status(500).json({ success: false, error: 'Failed to create link' });
    }
}
