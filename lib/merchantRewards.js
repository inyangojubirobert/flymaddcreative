// Credits a merchant's token balance when a participant they referred gets
// a vote confirmed. Nothing in the app credited merchant rewards anywhere
// before this - available_tokens could never organically go above zero,
// even though merchant-login.html has always advertised "50 tokens per
// confirmed vote from your referrals". That figure is the one used below;
// override MERCHANT_REWARD_TOKENS_PER_VOTE if the real number differs.
//
// Called after votes have already been credited (vote.js, paymentWebhook.js,
// scripts/reconcile-usdt-payments.mjs) - never blocks or throws back to the
// caller, since a reward-crediting failure must not undo an already-verified
// payment or vote.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TOKENS_PER_REFERRED_VOTE = parseFloat(process.env.MERCHANT_REWARD_TOKENS_PER_VOTE) || 50;

export async function creditMerchantReferralReward({ participantId, paymentId, voteCount }) {
  if (!participantId || !paymentId || !voteCount) return;

  try {
    const { data: participant } = await supabase
      .from('participants')
      .select('referred_by_merchant_link_id')
      .eq('id', participantId)
      .single();

    const linkId = participant?.referred_by_merchant_link_id;
    if (!linkId) return; // not a referred participant - nothing to credit

    const { data: link } = await supabase
      .from('merchant_referral_links')
      .select('merchant_id')
      .eq('id', linkId)
      .single();

    if (!link?.merchant_id) return;

    const tokens = TOKENS_PER_REFERRED_VOTE * voteCount;

    // payment_id has a unique index (see supabase/fix_merchant_schema.sql) -
    // this insert is the idempotency check. A second attempt to credit the
    // same payment (e.g. a retried webhook) hits 23505 and no-ops.
    const { error: insertError } = await supabase
      .from('merchant_referral_rewards')
      .insert({
        participant_id: participantId,
        merchant_link_id: linkId,
        merchant_id: link.merchant_id,
        payment_id: paymentId,
        tokens_awarded: tokens,
        status: 'paid',
        paid_at: new Date().toISOString()
      });

    if (insertError) {
      if (insertError.code === '23505') return; // already credited for this payment
      console.error('[merchantRewards] reward insert failed:', insertError.message);
      return;
    }

    const { error: creditError } = await supabase.rpc('credit_merchant_tokens', {
      p_merchant_id: link.merchant_id,
      p_amount: tokens
    });

    if (creditError) {
      console.error('[merchantRewards] token credit failed:', creditError.message);
    }
  } catch (error) {
    console.error('[merchantRewards] unexpected error:', error.message);
  }
}
