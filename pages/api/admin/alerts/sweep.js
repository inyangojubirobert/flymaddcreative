// Sends pending Telegram alerts, reminders and the daily summary
// (lib/adminInbox.js). Called every minute by pg_cron with the secret from
// admin_alert_config (supabase/add_admin_app_and_alarm.sql), or by Vercel cron.

import { createClient } from '@supabase/supabase-js';
import { getAlertConfig, isMissingSchema, runAdminAlertSweep } from '../../../../lib/adminInbox';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export default async function handler(req, res) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
    if (!isCron) {
      const c = await getAlertConfig(supabase);
      const given = String(req.headers['x-sweep-secret'] || '');
      if (!c?.sweep_secret || given.length < 32 || given !== c.sweep_secret) return res.status(403).json({ error: 'Forbidden' });
    }
    return res.status(200).json(await runAdminAlertSweep(supabase));
  } catch (error) {
    if (isMissingSchema(error)) return res.status(200).json({ sent: false, reason: 'not set up' });
    console.error('admin/alerts/sweep error:', error.message || error);
    return res.status(500).json({ error: 'Sweep failed' });
  }
}
