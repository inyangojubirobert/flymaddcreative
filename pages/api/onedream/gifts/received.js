// Public appreciation shown on a seller's profile.
//   GET ?username=<seller>
// Gifts received, supporter count, badges, monthly statistics and recent
// supporters (anonymous senders are never named). Recognition points are a
// display of appreciation only: not a balance, not withdrawable, not a
// prize entry or vote.

import { giftsDb, participantByUsername, recognitionSummary } from '../../../../lib/dreamCoins';
import { recognitionBadges } from '../../../../lib/dreamCoinsRules';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const username = String(req.query.username || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(username)) return res.status(400).json({ error: 'username is required' });

  try {
    const seller = await participantByUsername(username);
    if (!seller) return res.status(404).json({ error: 'Seller not found' });

    const summary = await recognitionSummary(seller.id);
    const monthly = {};
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5, 1);
    for (const row of summary.rows) {
      if (new Date(row.created_at) < sixMonthsAgo) continue;
      const month = row.created_at.slice(0, 7);
      monthly[month] = monthly[month] || { month, gifts: 0, points: 0, supporters: new Set() };
      monthly[month].gifts += 1;
      monthly[month].points += row.recognition_points;
      monthly[month].supporters.add(row.sender_id);
    }

    const { data: recent, error } = await giftsDb.from('virtual_gift_transactions')
      .select('id, gift_snapshot, quantity, recognition_points, message, is_anonymous, verified_buyer, created_at, sender:participants!virtual_gift_transactions_sender_id_fkey(username, name)')
      .eq('recipient_id', seller.id).eq('status', 'sent').order('created_at', { ascending: false }).limit(30);
    if (error) throw error;

    const giftCounts = {};
    for (const gift of recent || []) {
      const name = gift.gift_snapshot?.name || 'Gift';
      giftCounts[name] = giftCounts[name] || { name, emoji: gift.gift_snapshot?.emoji || null, image_url: gift.gift_snapshot?.image_url || null, count: 0 };
      giftCounts[name].count += gift.quantity;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({
      seller: { username: seller.username, name: seller.name },
      recognition_points: summary.points,
      gifts_received: summary.gifts,
      supporters: summary.supporters,
      badges: recognitionBadges(summary.points, summary.supporters),
      monthly: Object.values(monthly).sort((a, b) => b.month.localeCompare(a.month))
        .map((m) => ({ month: m.month, gifts: m.gifts, points: m.points, supporters: m.supporters.size })),
      recent_gifts: Object.values(giftCounts),
      recent: (recent || []).map((g) => ({
        id: g.id,
        gift: { name: g.gift_snapshot?.name, emoji: g.gift_snapshot?.emoji, image_url: g.gift_snapshot?.image_url },
        quantity: g.quantity,
        recognition_points: g.recognition_points,
        message: g.message,
        verified_buyer: g.verified_buyer,
        from: g.is_anonymous ? null : { username: g.sender?.username, name: g.sender?.name },
        created_at: g.created_at,
      })),
    });
  } catch (error) {
    console.error('gifts/received error:', error);
    return res.status(500).json({ error: 'Could not load appreciation' });
  }
}
