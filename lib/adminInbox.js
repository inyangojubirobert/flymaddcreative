// Admin inbox, alarm and Telegram alerts (supabase/add_admin_app_and_alarm.sql).
// Same design as Book of Memes: every message from a participant (questions
// and withdrawal requests) waits for an admin. It rings full-screen in the app
// (Admin tab) and goes to the admin's Telegram; reminders repeat every
// reminder_minutes until an admin checks it off or marks the conversation
// handled, and a daily summary lists what is still open. A new message from
// the participant rings again.
//
// One conversation per participant: support_messages rows, with
// admin_conversations holding handled / checked-off / reminder state.

const TELEGRAM = 'https://api.telegram.org';
const TELEGRAM_MAX = 4000;
const MAX_ATTEMPTS = 8;
const RECENT_MESSAGES = 3000;

const must = ({ data, error }) => { if (error) throw error; return data; };
const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
export const isMissingSchema = (error) => ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(error?.code)
  || /admin_conversations|admin_alert_config|tg_status|participant_id/.test(String(error?.message || ''));

// ── Telegram ───────────────────────────────────────────────────────────────────
export async function sendTelegram({ token, chatId }, text) {
  if (!token || !chatId) return { ok: false, error: 'Telegram is not connected' };
  try {
    const r = await fetch(`${TELEGRAM}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, TELEGRAM_MAX), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { ok: true } : { ok: false, error: j.description || `Telegram replied ${r.status}` };
  } catch (error) {
    return { ok: false, error: error.message || 'Telegram unreachable' };
  }
}

/** Finds the admin's chat from the last message they sent the bot. */
export async function findTelegramChat(token) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, error: 'That does not look like a bot token from @BotFather' };
  try {
    const me = await (await fetch(`${TELEGRAM}/bot${token}/getMe`)).json();
    if (!me.ok) return { ok: false, error: 'Telegram did not accept that bot token' };
    const up = await (await fetch(`${TELEGRAM}/bot${token}/getUpdates`)).json();
    const chat = [...(up.result || [])].reverse().map((u) => u.message?.chat || u.my_chat_member?.chat).find(Boolean);
    if (!chat) return { ok: false, error: `Open @${me.result.username} in Telegram, press Start (or send it any message), then try again` };
    return { ok: true, chatId: String(chat.id), bot: me.result.username };
  } catch (error) {
    return { ok: false, error: error.message || 'Telegram unreachable' };
  }
}

// ── Config ─────────────────────────────────────────────────────────────────────
export async function getAlertConfig(db) {
  return must(await db.from('admin_alert_config').select('*').eq('id', true).maybeSingle());
}
const ready = (c) => !!(c?.enabled && c.telegram_bot_token && c.telegram_chat_id);
const tg = (c) => ({ token: c.telegram_bot_token, chatId: c.telegram_chat_id });

export function configView(c) {
  return {
    enabled: !!c?.enabled,
    telegram_connected: !!(c?.telegram_bot_token && c?.telegram_chat_id),
    telegram_bot: c?.telegram_bot_username || null,
    reminder_minutes: c?.reminder_minutes ?? 15,
    digest_hour: c?.digest_hour ?? 8,
    timezone: c?.timezone || 'Africa/Lagos',
  };
}

// ── Conversations ─────────────────────────────────────────────────────────────
/**
 * Every participant conversation from recent messages, newest activity first.
 * waiting: the participant wrote last and it isn't marked handled since.
 * ringing: waiting and not checked off since the participant's last message.
 */
export async function loadConversations(db) {
  const messages = must(await db.from('support_messages')
    .select('id, participant_id, withdrawal_id, sender_type, body, created_at')
    .order('created_at', { ascending: false }).limit(RECENT_MESSAGES)) || [];
  const byParticipant = new Map();
  for (const m of messages) {
    const c = byParticipant.get(m.participant_id) || { participant_id: m.participant_id, last: m, last_user: null, withdrawal: false, count: 0 };
    c.count += 1;
    if (m.sender_type === 'participant') {
      if (!c.last_user) c.last_user = m;
      if (m.withdrawal_id && c.last_user === m) c.withdrawal = true;
    }
    byParticipant.set(m.participant_id, c);
  }
  const ids = [...byParticipant.keys()];
  if (!ids.length) return [];
  const [people, states] = await Promise.all([
    db.from('participants').select('id, name, username, email').in('id', ids),
    db.from('admin_conversations').select('*').in('participant_id', ids),
  ]);
  if (people.error) throw people.error;
  const personById = new Map((people.data || []).map((p) => [p.id, p]));
  const stateById = new Map(((states.error ? [] : states.data) || []).map((s) => [s.participant_id, s]));

  return ids.map((id) => {
    const c = byParticipant.get(id);
    const s = stateById.get(id) || {};
    const userAt = ms(c.last_user?.created_at);
    const waiting = !!c.last_user && c.last.sender_type === 'participant' && ms(s.handled_at) < userAt;
    const open = !!c.last_user && ms(s.handled_at) < userAt;
    return {
      participant_id: id,
      participant: personById.get(id) || null,
      kind: c.withdrawal ? 'withdrawal' : 'support',
      label: c.withdrawal ? 'Withdrawal' : 'Message',
      status: open ? 'open' : 'handled',
      waiting,
      ringing: waiting && ms(s.ack_at) < userAt,
      waiting_since: c.last_user?.created_at || null,
      last_message: { body: String(c.last.body || '').slice(0, 300), sender_type: c.last.sender_type, created_at: c.last.created_at },
      last_user_message: c.last_user ? String(c.last_user.body || '').slice(0, 300) : '',
      reminder_count: ms(s.reminder_last_at) > userAt ? s.reminder_count || 0 : 0,
      reminder_last_at: s.reminder_last_at || null,
    };
  });
}

export async function setConversationState(db, participantId, fields) {
  must(await db.from('admin_conversations')
    .upsert({ participant_id: participantId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'participant_id' }));
}

// ── Sending ────────────────────────────────────────────────────────────────────
const who = (p) => (p ? `@${p.username}${p.name ? ` (${p.name})` : ''}` : 'a participant');
const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - ms(iso)) / 60000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};
const FOOTER = '\n\nAnswer in the One Dream app: Admin tab → Inbox';

/** Marks a new participant message for Telegram and tries to send it now. Never throws. */
export async function queueAdminTelegram(db, messageId) {
  try {
    const { error } = await db.from('support_messages').update({ tg_status: 'pending' }).eq('id', messageId).eq('tg_status', 'none');
    if (error) { if (!isMissingSchema(error)) console.error('admin telegram queue:', error.message); return; }
    const c = await getAlertConfig(db);
    if (ready(c)) await sendPending(db, c);
  } catch (error) {
    if (!isMissingSchema(error)) console.error('admin telegram send:', error.message || error);
  }
}

async function sendPending(db, c) {
  const now = new Date().toISOString();
  const rows = must(await db.from('support_messages')
    .select('id, participant_id, withdrawal_id, body, created_at, tg_attempts')
    .eq('tg_status', 'pending').or(`tg_next_try_at.is.null,tg_next_try_at.lte.${now}`)
    .order('created_at', { ascending: true }).limit(30)) || [];
  if (!rows.length) return;
  const people = must(await db.from('participants').select('id, name, username').in('id', [...new Set(rows.map((r) => r.participant_id))])) || [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const text = rows.map((m) => [
    `📩 ${m.withdrawal_id ? 'Withdrawal' : 'Message'} from ${who(byId.get(m.participant_id))}`,
    m.body.length > 600 ? `${m.body.slice(0, 600)}…` : m.body,
  ].join('\n')).join('\n\n');
  const r = await sendTelegram(tg(c), (text.slice(0, TELEGRAM_MAX - FOOTER.length) + FOOTER));
  const ids = rows.map((m) => m.id);
  if (r.ok) {
    await db.from('support_messages').update({ tg_status: 'sent', tg_error: null }).in('id', ids);
    return;
  }
  console.error('admin telegram failed:', r.error);
  for (const m of rows) {
    const attempts = (m.tg_attempts || 0) + 1;
    await db.from('support_messages').update({
      tg_attempts: attempts,
      tg_error: String(r.error).slice(0, 300),
      tg_status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      tg_next_try_at: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60e3).toISOString(),
    }).eq('id', m.id);
  }
}

async function sendReminders(db, c, conversations) {
  const every = Math.max(5, c.reminder_minutes || 15) * 60e3;
  const cap = c.max_reminders || 24;
  const now = Date.now();
  const due = conversations.filter((t) => t.ringing
    && now - Math.max(ms(t.waiting_since), ms(t.reminder_last_at)) >= every
    && t.reminder_count < cap);
  if (!due.length) return;
  const lines = due.slice(0, 10).map((t) => `• ${t.label}: ${who(t.participant)}, waiting ${ago(t.waiting_since)}\n  “${t.last_user_message.slice(0, 120)}”`);
  const text = `🔔 Reminder: ${due.length} message${due.length === 1 ? '' : 's'} still waiting for an admin.\n\n${lines.join('\n')}`
    + (due.length > 10 ? `\n…and ${due.length - 10} more.` : '') + '\n\nCheck them off in the app (Admin tab) to stop these reminders.';
  const r = await sendTelegram(tg(c), text);
  if (!r.ok) { console.error('admin reminder failed:', r.error); return; }
  const stamp = new Date().toISOString();
  for (const t of due) await setConversationState(db, t.participant_id, { reminder_last_at: stamp, reminder_count: t.reminder_count + 1 });
}

function localNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function sendDigest(db, c, conversations) {
  const { date, hour } = localNow(c.timezone || 'Africa/Lagos');
  if (hour < c.digest_hour || String(c.last_digest_on || '') === date) return;
  const open = conversations.filter((t) => t.status === 'open').sort((a, b) => ms(a.waiting_since) - ms(b.waiting_since));
  if (open.length) {
    const lines = open.slice(0, 10).map((t) => `• ${t.label}: ${who(t.participant)}, waiting ${ago(t.waiting_since)}`);
    const text = `⏰ One Dream: ${open.length} conversation${open.length === 1 ? '' : 's'} still open.\n\n${lines.join('\n')}`
      + (open.length > 10 ? `\n…and ${open.length - 10} more.` : '') + '\n\nAdmin tab → Inbox';
    const r = await sendTelegram(tg(c), text);
    if (!r.ok) { console.error('admin digest failed:', r.error); return; }
  }
  await db.from('admin_alert_config').update({ last_digest_on: date }).eq('id', true);
}

/** Pending alerts, reminders and the daily summary. Run every minute by pg_cron. */
export async function runAdminAlertSweep(db) {
  const c = await getAlertConfig(db);
  if (!ready(c)) return { sent: false, reason: 'alerts off' };
  await sendPending(db, c);
  const conversations = await loadConversations(db);
  await sendReminders(db, c, conversations).catch((e) => console.error('admin reminders:', e.message));
  await sendDigest(db, c, conversations).catch((e) => console.error('admin digest:', e.message));
  return { sent: true };
}
