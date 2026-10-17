// The signed-in participant's Dream Coin wallet: balance, coin purchases,
// ledger entries and gifts sent. Dream Coins are not withdrawable and have
// no cash value - this is separate from the marketplace / vote wallet.

import { requireParticipant } from '../../../../lib/participantAuth';
import { dreamCoinsEnabled, getBalanceRow, giftsDb } from '../../../../lib/dreamCoins';

const must = ({ data, error }) => {
  if (error) throw error;
  return data || [];
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const [balance, purchases, ledger, sent] = await Promise.all([
      getBalanceRow(participant.id),
      giftsDb.from('dream_coin_purchases')
        .select('id, package_id, order_id, quantity, coins_per_unit, total_coins, status, reversed_quantity, consumption_state, purchased_at, created_at')
        .eq('participant_id', participant.id).order('created_at', { ascending: false }).limit(50).then(must),
      giftsDb.from('dream_coin_ledger').select('id, entry_type, coins, balance_after, note, created_at')
        .eq('participant_id', participant.id).order('id', { ascending: false }).limit(100).then(must),
      giftsDb.from('virtual_gift_transactions')
        .select('id, gift_snapshot, quantity, coins_spent, message, is_anonymous, verified_buyer, status, created_at, recipient:participants!virtual_gift_transactions_recipient_id_fkey(username, name)')
        .eq('sender_id', participant.id).order('created_at', { ascending: false }).limit(50).then(must),
    ]);
    return res.status(200).json({
      billing_enabled: dreamCoinsEnabled(),
      balance: balance?.balance ?? 0,
      lifetime_purchased: balance?.lifetime_purchased ?? 0,
      lifetime_spent: balance?.lifetime_spent ?? 0,
      gifting_suspended: !!balance?.gifting_suspended,
      purchases,
      ledger,
      sent,
    });
  } catch (error) {
    console.error('gifts/history error:', error);
    return res.status(500).json({ error: 'Could not load your Dream Coins' });
  }
}
