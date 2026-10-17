// Admin overview of Dream Coins & virtual gifts (read only).
//   GET -> { billing_enabled, limits, packages, gifts, programs, purchases,
//            transfers, ledger, refunds, audit, awards, signals, totals }
// `signals` flags activity worth a look - never acted on automatically:
//   heavy_sender      >= 10 gifts or >= 5,000 coins sent in 24 h
//   repeated_pair     same sender -> same recipient >= 5 times in 7 days
//   negative_balance  coins refunded by Google after they were spent
//   reversed_purchase refunded / revoked coin purchases (last 30 days)

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { GIFT_LIMITS, dreamCoinsEnabled, giftsDb } from '../../../../lib/dreamCoins';

const must = ({ data, error }) => {
  if (error) throw error;
  return data || [];
};
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;

  try {
    const [packages, gifts, programs, purchases, transfers, ledger, refunds, audit, awards, recentWeek, negative, reversed] = await Promise.all([
      giftsDb.from('dream_coin_packages').select('*').order('sort_order').then(must),
      giftsDb.from('virtual_gift_catalogue').select('*').order('display_priority').then(must),
      giftsDb.from('reward_programs').select('*').order('sort_order').then(must),
      giftsDb.from('dream_coin_purchases').select('*, participant:participants(username)').order('created_at', { ascending: false }).limit(100).then(must),
      giftsDb.from('virtual_gift_transactions')
        .select('*, sender:participants!virtual_gift_transactions_sender_id_fkey(username), recipient:participants!virtual_gift_transactions_recipient_id_fkey(username)')
        .order('created_at', { ascending: false }).limit(100).then(must),
      giftsDb.from('dream_coin_ledger').select('*, participant:participants(username)').order('id', { ascending: false }).limit(100).then(must),
      giftsDb.from('virtual_gift_refunds').select('*').order('created_at', { ascending: false }).limit(50).then(must),
      giftsDb.from('dream_gifting_admin_audit').select('*').order('id', { ascending: false }).limit(100).then(must),
      giftsDb.from('reward_awards').select('*, participant:participants(username)').order('created_at', { ascending: false }).limit(100).then(must),
      giftsDb.from('virtual_gift_transactions').select('sender_id, recipient_id, coins_spent, created_at').eq('status', 'sent').gte('created_at', hoursAgo(24 * 7)).limit(20000).then(must),
      giftsDb.from('dream_coin_balances').select('participant_id, balance, gifting_suspended, participant:participants(username)').lt('balance', 0).limit(100).then(must),
      giftsDb.from('dream_coin_purchases').select('id, participant_id, status, reversed_quantity, quantity, updated_at, participant:participants(username)')
        .neq('status', 'credited').gte('updated_at', hoursAgo(24 * 30)).limit(100).then(must),
    ]);

    const since24 = hoursAgo(24);
    const senders = new Map();
    const pairs = new Map();
    for (const row of recentWeek) {
      const pair = `${row.sender_id}>${row.recipient_id}`;
      pairs.set(pair, (pairs.get(pair) || 0) + 1);
      if (row.created_at >= since24) {
        const s = senders.get(row.sender_id) || { gifts: 0, coins: 0 };
        s.gifts += 1;
        s.coins += row.coins_spent;
        senders.set(row.sender_id, s);
      }
    }
    const ids = new Set();
    const heavy = [...senders.entries()].filter(([, s]) => s.gifts >= 10 || s.coins >= 5000);
    const repeated = [...pairs.entries()].filter(([, n]) => n >= 5).map(([key, n]) => [...key.split('>'), n]);
    heavy.forEach(([id]) => ids.add(id));
    repeated.forEach(([a, b]) => { ids.add(a); ids.add(b); });
    const people = ids.size ? must(await giftsDb.from('participants').select('id, username').in('id', [...ids])) : [];
    const name = (id) => people.find((p) => p.id === id)?.username || id;

    const signals = [
      ...heavy.map(([id, s]) => ({ type: 'heavy_sender', participant_id: id, username: name(id), detail: `${s.gifts} gifts, ${s.coins} coins in 24 h` })),
      ...repeated.map(([from, to, n]) => ({ type: 'repeated_pair', participant_id: from, username: name(from), detail: `${n} gifts to @${name(to)} in 7 days` })),
      ...negative.map((b) => ({ type: 'negative_balance', participant_id: b.participant_id, username: b.participant?.username, detail: `balance ${b.balance}${b.gifting_suspended ? ' (suspended)' : ''}` })),
      ...reversed.map((p) => ({ type: 'reversed_purchase', participant_id: p.participant_id, username: p.participant?.username, detail: `${p.reversed_quantity}/${p.quantity} unit(s) ${p.status}` })),
    ];

    const real = purchases.filter((p) => !p.is_test);
    return res.status(200).json({
      billing_enabled: dreamCoinsEnabled(),
      limits: GIFT_LIMITS,
      packages, gifts, programs, purchases, transfers, ledger, refunds, audit, awards, signals,
      totals: {
        recent_purchases: real.length,
        recent_coins_issued: real.reduce((sum, p) => sum + p.total_coins, 0),
        recent_gifts: transfers.length,
        recent_coins_spent: transfers.filter((t) => t.status === 'sent').reduce((sum, t) => sum + t.coins_spent, 0),
      },
    });
  } catch (error) {
    console.error('admin/gifts error:', error);
    return res.status(500).json({ error: 'Could not load gifting data' });
  }
}
