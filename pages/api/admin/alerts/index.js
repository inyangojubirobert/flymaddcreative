// Admin alert settings (Telegram), from the app's Admin tab.
//   GET                                                            settings
//   POST { telegram_bot_token?, enabled?, reminder_minutes?, digest_hour? }  save
//   POST { action: 'test' }                                        send a test message

import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { configView, findTelegramChat, getAlertConfig, isMissingSchema, sendTelegram } from '../../../../lib/adminInbox';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ alerts: configView(await getAlertConfig(supabase)) });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.action === 'test') {
      const c = await getAlertConfig(supabase);
      const r = await sendTelegram({ token: c?.telegram_bot_token, chatId: c?.telegram_chat_id },
        '✅ One Dream: Telegram alerts are working. New messages and withdrawal requests for the admin will arrive here.');
      if (!r.ok) return res.status(400).json({ error: r.error });
      return res.status(200).json({ sent: true });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (b.telegram_bot_token) {
      const token = String(b.telegram_bot_token).trim();
      const found = await findTelegramChat(token);
      if (!found.ok) return res.status(400).json({ error: found.error });
      Object.assign(patch, { telegram_bot_token: token, telegram_chat_id: found.chatId, telegram_bot_username: found.bot, enabled: true });
    }
    if (b.reminder_minutes !== undefined) {
      const m = Math.round(Number(b.reminder_minutes));
      if (!(m >= 5 && m <= 720)) return res.status(400).json({ error: 'Reminders: every 5 to 720 minutes' });
      patch.reminder_minutes = m;
    }
    if (b.digest_hour !== undefined) {
      const h = Number(b.digest_hour);
      if (!Number.isInteger(h) || h < 0 || h > 23) return res.status(400).json({ error: 'Daily summary hour: 0 to 23' });
      patch.digest_hour = h;
    }
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    const { data: c, error } = await supabase.from('admin_alert_config').update(patch).eq('id', true).select('*').single();
    if (error) throw error;
    if (c.enabled && !(c.telegram_bot_token && c.telegram_chat_id)) {
      await supabase.from('admin_alert_config').update({ enabled: false }).eq('id', true);
      return res.status(400).json({ error: 'Connect your Telegram bot before turning alerts on' });
    }
    return res.status(200).json({ alerts: configView(c) });
  } catch (error) {
    if (isMissingSchema(error)) return res.status(503).json({ error: 'Run supabase/add_admin_app_and_alarm.sql first' });
    console.error('admin/alerts error:', error.message || error);
    return res.status(500).json({ error: 'Alert settings failed' });
  }
}
