// Everything a person earns outside their own shop's sales, in one place.
// Works with a participant token (creators, partners) or a merchant token
// (gift referrals, seller/buyer referrals). Each source keeps its own
// balance: pending, available, reserved (in a withdrawal), paid.
//   GET -> { party, settings, balances, totals, gift_earnings, gift_referrals,
//            referred_recipients, attributions, referral_rewards, payouts, payee, ledger }

import { balancesFor, earningsDb, getEarningsSettings, must, payoutsLiveInDeployment, requireParty, runAffiliateJobs } from '../../../lib/earnings';

const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const party = await requireParty(req, res);
  if (!party) return;

  try {
    // Keep attribution and release up to date even between scheduled runs.
    await runAffiliateJobs().catch((error) => console.error('earnings/summary jobs:', error.message));

    const settings = await getEarningsSettings();
    // A participant linked to a merchant account sees both parties' earnings.
    const parties = [{ type: party.party_type, id: party.party_id }];
    if (party.party_type === 'participant' && party.merchant_id) parties.push({ type: 'merchant', id: party.merchant_id });
    if (party.party_type === 'merchant' && party.linked_participant_id) parties.push({ type: 'participant', id: party.linked_participant_id });
    const participantId = parties.find((p) => p.type === 'participant')?.id || null;
    const merchantId = parties.find((p) => p.type === 'merchant')?.id || null;

    const balances = {};
    for (const p of parties) balances[p.type] = await balancesFor(p.type, p.id);

    const [giftEarnings, giftReferrals, referredRecipients, partner, rewards, payouts, payees, ledger] = await Promise.all([
      participantId ? earningsDb.from('gift_earnings')
        .select('gift_transaction_id, status, created_at, recipient_percent, value_basis, components:gift_earning_components(coins, provisional_value_micro, final_value_micro, recipient_micro, reversed_recipient_micro, released), gift:virtual_gift_transactions(gift_snapshot, quantity, is_anonymous, sender:participants!virtual_gift_transactions_sender_id_fkey(username))')
        .eq('recipient_id', participantId).order('created_at', { ascending: false }).limit(50).then(must) : [],
      merchantId ? earningsDb.from('gift_earnings')
        .select('gift_transaction_id, status, created_at, merchant_percent, merchant_entitled_until, recipient:participants!gift_earnings_recipient_id_fkey(username), components:gift_earning_components(merchant_micro, reversed_merchant_micro, released)')
        .eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(50).then(must) : [],
      merchantId ? earningsDb.from('merchant_referral_links').select('id').eq('merchant_id', merchantId).then(async (links) => {
        const ids = must(links).map((l) => l.id);
        if (!ids.length) return [];
        return must(await earningsDb.from('participants').select('username, created_at').in('referred_by_merchant_link_id', ids).order('created_at', { ascending: false }).limit(200));
      }) : [],
      participantId ? earningsDb.from('affiliate_partners').select('id, handle').eq('participant_id', participantId).maybeSingle().then(must) : null,
      merchantId ? earningsDb.from('referral_rewards').select('id, kind, amount_micro, status, created_at, order_id').eq('merchant_id', merchantId)
        .order('created_at', { ascending: false }).limit(50).then(must) : [],
      Promise.all(parties.map((p) => earningsDb.from('payout_requests').select('id, party_type, source, amount_micro, status, external_reference, failure_reason, created_at, paid_at')
        .eq('party_type', p.type).eq('party_id', p.id).order('created_at', { ascending: false }).limit(50).then(must))).then((r) => r.flat()),
      Promise.all(parties.map((p) => earningsDb.from('payee_profiles').select('party_type, legal_name, country, payout_method, payout_details, kyc_status, kyc_note, date_of_birth')
        .eq('party_type', p.type).eq('party_id', p.id).maybeSingle().then(must))).then((r) => r.filter(Boolean)),
      Promise.all(parties.map((p) => earningsDb.from('partner_ledger').select('id, party_type, source, bucket, amount_micro, entry_type, note, created_at')
        .eq('party_type', p.type).eq('party_id', p.id).order('id', { ascending: false }).limit(60).then(must))).then((r) => r.flat()),
    ]);

    const attributions = partner ? must(await earningsDb.from('affiliate_attributions')
      .select('id, model, funding, source, gross_micro, commission_percent, commission_micro, status, status_reason, created_at, released_at, offer:affiliate_offers(item:catalogue_items(title))')
      .eq('partner_id', partner.id).order('created_at', { ascending: false }).limit(50)) : [];

    const months = settings.gift_merchant_months;
    const now = Date.now();
    return res.status(200).json({
      party: { type: party.party_type, id: party.party_id, participant_id: participantId, merchant_id: merchantId, partner_handle: partner?.handle || null },
      settings: {
        gift_earnings_enabled: settings.gift_earnings_enabled,
        payouts_open: settings.payouts_enabled && payoutsLiveInDeployment(),
        min_payout_micro: Number(settings.min_payout_micro),
        gift_recipient_percent: Number(settings.gift_recipient_percent),
        gift_merchant_percent: Number(settings.gift_merchant_percent),
        gift_merchant_months: months,
        gift_value_basis: settings.gift_value_basis,
        seller_funded_settlement_enabled: settings.seller_funded_settlement_enabled,
        resale_checkout_enabled: settings.resale_checkout_enabled,
      },
      balances,
      gift_earnings: giftEarnings.map((g) => ({
        id: g.gift_transaction_id,
        created_at: g.created_at,
        status: g.status,
        gift: g.gift?.gift_snapshot?.name,
        quantity: g.gift?.quantity,
        from: g.gift?.is_anonymous ? null : g.gift?.sender?.username,
        recipient_micro: sum(g.components, 'recipient_micro') - sum(g.components, 'reversed_recipient_micro'),
        reconciled: g.components.every((c) => c.final_value_micro !== null),
        withdrawable: g.components.every((c) => c.released),
      })),
      gift_referrals: giftReferrals.map((g) => ({
        id: g.gift_transaction_id,
        created_at: g.created_at,
        status: g.status,
        recipient: g.recipient?.username,
        merchant_micro: sum(g.components, 'merchant_micro') - sum(g.components, 'reversed_merchant_micro'),
        withdrawable: g.components.every((c) => c.released),
      })),
      referred_recipients: referredRecipients.map((p) => {
        const until = new Date(p.created_at);
        until.setMonth(until.getMonth() + months);
        return { username: p.username, registered_at: p.created_at, gift_share_until: until.toISOString(), active: until.getTime() > now };
      }),
      attributions: attributions.map((a) => ({ ...a, title: a.offer?.item?.title || null, offer: undefined })),
      referral_rewards: rewards,
      payouts,
      payees,
      ledger: ledger.sort((a, b) => b.id - a.id).slice(0, 60),
    });
  } catch (error) {
    console.error('earnings/summary error:', error);
    return res.status(500).json({ error: 'Could not load your earnings' });
  }
}
