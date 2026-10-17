// Recognition leaderboards. Recognition only - no prizes, and gift totals are
// never used to decide eligibility for any cash award.
//   GET ?board=most_appreciated   appreciation received (last `days`, default 30)
//   GET ?board=reliable_merchants verified seller performance from delivered
//                                 marketplace orders (read only, last 180 days)
// The two boards are kept separate on purpose: popularity is not performance.

import { giftsDb } from '../../../../lib/dreamCoins';

const NOTICE = 'Recognition only. No prizes or money are awarded from this board, and gift totals never decide cash awards.';
const must = ({ data, error }) => {
  if (error) throw error;
  return data || [];
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const board = String(req.query.board || 'most_appreciated');

  try {
    let entries;
    if (board === 'most_appreciated') {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const rows = must(await giftsDb.from('virtual_gift_transactions').select('recipient_id, sender_id, recognition_points')
        .eq('status', 'sent').gte('created_at', new Date(Date.now() - days * 86400e3).toISOString()).limit(20000));
      const totals = new Map();
      for (const row of rows) {
        const t = totals.get(row.recipient_id) || { points: 0, gifts: 0, supporters: new Set() };
        t.points += row.recognition_points;
        t.gifts += 1;
        t.supporters.add(row.sender_id);
        totals.set(row.recipient_id, t);
      }
      const top = [...totals.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 20);
      const people = top.length ? must(await giftsDb.from('participants').select('id, username, name').in('id', top.map(([id]) => id))) : [];
      const byId = new Map(people.map((p) => [p.id, p]));
      entries = top.filter(([id]) => byId.has(id)).map(([id, t], index) => ({
        rank: index + 1, username: byId.get(id).username, name: byId.get(id).name,
        recognition_points: t.points, gifts: t.gifts, supporters: t.supporters.size,
      }));
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ board, days, notice: NOTICE, entries });
    }

    if (board === 'reliable_merchants') {
      const orders = must(await giftsDb.from('catalogue_orders').select('seller_username, status')
        .in('status', ['buyer_confirmed', 'released', 'disputed'])
        .gte('created_at', new Date(Date.now() - 180 * 86400e3).toISOString()).limit(20000));
      const sellers = new Map();
      for (const order of orders) {
        const s = sellers.get(order.seller_username) || { confirmed: 0, disputed: 0 };
        if (order.status === 'disputed') s.disputed += 1; else s.confirmed += 1;
        sellers.set(order.seller_username, s);
      }
      const ranked = [...sellers.entries()]
        .map(([username, s]) => ({ username, confirmed_sales: s.confirmed, reliability: s.confirmed / (s.confirmed + s.disputed) }))
        .filter((s) => s.confirmed_sales >= 5)
        .sort((a, b) => b.reliability - a.reliability || b.confirmed_sales - a.confirmed_sales)
        .slice(0, 20);
      const people = ranked.length ? must(await giftsDb.from('participants').select('username, name').in('username', ranked.map((s) => s.username))) : [];
      const names = new Map(people.map((p) => [p.username, p.name]));
      entries = ranked.map((s, index) => ({ rank: index + 1, ...s, name: names.get(s.username) || s.username, reliability: Math.round(s.reliability * 1000) / 10 }));
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
      return res.status(200).json({ board, days: 180, notice: NOTICE, entries });
    }

    return res.status(400).json({ error: 'board must be most_appreciated or reliable_merchants' });
  } catch (error) {
    console.error('rewards/leaderboards error:', error);
    return res.status(500).json({ error: 'Could not load the leaderboard' });
  }
}
