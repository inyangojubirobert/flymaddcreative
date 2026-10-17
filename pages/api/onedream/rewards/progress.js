// The signed-in participant's progress in each active recognition programme,
// plus awards received. Metrics come from verified activity only: delivered
// marketplace orders (read only), appreciation received and verified-buyer
// thank-yous. Metrics we cannot measure yet are reported as "not_tracked".

import { requireParticipant } from '../../../../lib/participantAuth';
import { giftsDb, programFields, recognitionSummary, sellerOrderMetrics } from '../../../../lib/dreamCoins';
import { evaluateProgram } from '../../../../lib/dreamCoinsRules';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const [{ data: programs, error }, { data: awards, error: awardsError }] = await Promise.all([
      giftsDb.from('reward_programs').select(programFields).eq('is_active', true).order('sort_order'),
      giftsDb.from('reward_awards').select('id, program_id, period, title, status, created_at')
        .eq('participant_id', participant.id).eq('status', 'awarded').order('created_at', { ascending: false }).limit(50),
    ]);
    if (error) throw error;
    if (awardsError) throw awardsError;

    const cache = new Map();
    async function metricsFor(windowDays) {
      if (!cache.has(windowDays)) {
        const since = new Date(Date.now() - windowDays * 86400e3).toISOString();
        cache.set(windowDays, (async () => {
          const [orders, recognition, thanks] = await Promise.all([
            sellerOrderMetrics(participant.username, windowDays),
            recognitionSummary(participant.id, windowDays),
            giftsDb.from('virtual_gift_transactions').select('id', { count: 'exact', head: true })
              .eq('sender_id', participant.id).eq('verified_buyer', true).eq('status', 'sent').gte('created_at', since),
          ]);
          if (thanks.error) throw thanks.error;
          return {
            ...orders,
            recognition_points: recognition.points,
            supporters: recognition.supporters,
            verified_appreciations: thanks.count || 0,
          };
        })());
      }
      return cache.get(windowDays);
    }

    const progress = [];
    for (const program of programs || []) {
      const windowDays = Math.min(Math.max(Number(program.criteria?.window_days) || 90, 1), 365);
      progress.push({ program, window_days: windowDays, ...evaluateProgram(program, await metricsFor(windowDays)) });
    }
    return res.status(200).json({ progress, awards: awards || [] });
  } catch (error) {
    console.error('rewards/progress error:', error);
    return res.status(500).json({ error: 'Could not load your progress' });
  }
}
