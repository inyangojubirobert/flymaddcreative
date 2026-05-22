import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { id } = req.query;

    try {
        // Get merchant info
        const { data: merchant, error: merchantError } = await supabase
            .from('referral_merchants')
            .select('id, merchant_name, email, company_name, wallet_address, total_tokens_earned, available_tokens, status, created_at')
            .eq('id', id)
            .single();

        if (merchantError || !merchant) {
            return res.status(404).json({ success: false, error: 'Merchant not found' });
        }

        // Get referral links
        const { data: referralLinks } = await supabase
            .from('merchant_referral_links')
            .select('id, link_code, full_link, description, is_active, clicks_count, registrations_count, created_at')
            .eq('merchant_id', id)
            .order('created_at', { ascending: false });

        // Get referred participants with rewards
        const { data: referrals } = await supabase
            .from('participants')
            .select(`
                id, name, email, created_at,
                referred_by_merchant_link_id,
                merchant_referral_links!inner ( id, link_code, merchant_id ),
                merchant_referral_rewards ( id, tokens_awarded, status, created_at, paid_at )
            `)
            .eq('merchant_referral_links.merchant_id', id)
            .order('created_at', { ascending: false })
            .limit(50);

        const totalReferrals = referrals?.length || 0;
        const pendingVotes = referrals?.filter(r => r.merchant_referral_rewards?.[0]?.status === 'pending').length || 0;
        const completedVotes = referrals?.filter(r => r.merchant_referral_rewards?.[0]?.status === 'paid').length || 0;
        const totalClicks = referralLinks?.reduce((sum, l) => sum + (l.clicks_count || 0), 0) || 0;
        const conversionRate = totalClicks > 0 ? Math.round((totalReferrals / totalClicks) * 100) : 0;
        const pendingTokens = referrals?.reduce((sum, r) => {
            const reward = r.merchant_referral_rewards?.[0];
            return reward?.status === 'pending' ? sum + (reward.tokens_awarded || 0) : sum;
        }, 0) || 0;

        const recentActivity = (referrals || []).slice(0, 20).map(ref => ({
            participant: { id: ref.id, name: ref.name, email: ref.email },
            registered_date: ref.created_at,
            link_used: ref.merchant_referral_links?.link_code,
            reward: ref.merchant_referral_rewards?.[0] ? {
                tokens: ref.merchant_referral_rewards[0].tokens_awarded,
                status: ref.merchant_referral_rewards[0].status,
                created_at: ref.merchant_referral_rewards[0].created_at,
                paid_at: ref.merchant_referral_rewards[0].paid_at
            } : null
        }));

        return res.status(200).json({
            success: true,
            merchant,
            stats: {
                total_referrals: totalReferrals,
                pending_votes: pendingVotes,
                completed_votes: completedVotes,
                total_clicks: totalClicks,
                conversion_rate: conversionRate,
                total_tokens_earned: merchant.total_tokens_earned || 0,
                available_tokens: merchant.available_tokens || 0,
                pending_tokens: pendingTokens
            },
            referral_links: referralLinks || [],
            recent_activity: recentActivity
        });

    } catch (err) {
        console.error('Dashboard error:', err);
        return res.status(500).json({ success: false, error: 'Failed to load dashboard' });
    }
}
