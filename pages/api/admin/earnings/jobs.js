// Runs the server-side earnings jobs: match pre-payment affiliate intents to
// verified orders, move attributions with their orders, pay referral rewards.
//   GET  (Vercel cron, Authorization: Bearer <CRON_SECRET>)
//   POST (admin portal)
// Idempotent: running it again changes nothing that has already been applied.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { earningsDb, runAffiliateJobs } from '../../../../lib/earnings';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  if (!isCron) {
    if (req.method === 'GET') return res.status(405).json({ error: 'Use POST' });
    const admin = await requireActiveAdmin(req, res, earningsDb);
    if (!admin) return;
  }
  try {
    return res.status(200).json(await runAffiliateJobs());
  } catch (error) {
    console.error('admin/earnings/jobs error:', error.message || error);
    return res.status(500).json({ error: 'Jobs failed' });
  }
}
