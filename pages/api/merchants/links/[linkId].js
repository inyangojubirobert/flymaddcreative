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

    const { linkId } = req.query;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
        return res.status(400).json({ success: false, error: 'is_active must be a boolean' });
    }

    try {
        const { data: link, error } = await supabase
            .from('merchant_referral_links')
            .update({ is_active })
            .eq('id', linkId)
            .select('id, link_code, is_active')
            .single();

        if (error || !link) {
            return res.status(404).json({ success: false, error: 'Link not found' });
        }

        return res.status(200).json({
            success: true,
            message: `Link ${is_active ? 'activated' : 'deactivated'}`,
            link
        });

    } catch (err) {
        console.error('Toggle link error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update link' });
    }
}
