// Admin inbox, alarm and Telegram reminders (lib/adminInbox.js) against a
// small in-memory stand-in for the Supabase client. node --test scripts/test-admin-inbox.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConversations, queueAdminTelegram, runAdminAlertSweep, setConversationState } from '../lib/adminInbox.js';

/** Just enough of the supabase-js query builder for lib/adminInbox.js. */
function fakeDb(tables) {
  const from = (name) => {
    const rows = (tables[name] ||= []);
    let filters = [];
    let op = 'select';
    let patch = null;
    let order = null;
    let limit = Infinity;
    const q = {
      select() { return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
      or(expr) { // tg_next_try_at.is.null,tg_next_try_at.lte.<iso>
        const iso = expr.split('lte.')[1];
        filters.push((r) => r.tg_next_try_at == null || r.tg_next_try_at <= iso); return q;
      },
      order(col, { ascending }) { order = [col, ascending]; return q; },
      limit(n) { limit = n; return q; },
      update(p) { op = 'update'; patch = p; return q; },
      upsert(row) {
        const key = 'participant_id';
        const existing = rows.find((r) => r[key] === row[key]);
        if (existing) Object.assign(existing, row); else rows.push({ reminder_count: 0, ...row });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() { return run().then(({ data, error }) => ({ data: data?.[0] || null, error })); },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    const run = async () => {
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      if (order) hit = [...hit].sort((a, b) => (a[order[0]] < b[order[0]] ? -1 : 1) * (order[1] ? 1 : -1));
      return { data: hit.slice(0, limit), error: null };
    };
    return q;
  };
  return { from };
}

const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const people = [{ id: P1, name: 'Ada', username: 'ada' }, { id: P2, name: 'Bo', username: 'bo' }];

const realFetch = globalThis.fetch;
const telegram = () => {
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, text: JSON.parse(init.body).text }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  return sent;
};
test.afterEach(() => { globalThis.fetch = realFetch; });

test('a participant message waits and rings; an admin reply stops it; checked-off stops ringing until they write again', async () => {
  const tables = {
    participants: people,
    admin_conversations: [],
    support_messages: [
      { id: 'm1', participant_id: P1, sender_type: 'participant', body: 'Where is my payout?', created_at: ago(30) },
      { id: 'm2', participant_id: P2, sender_type: 'participant', body: 'Hi', created_at: ago(50) },
      { id: 'm3', participant_id: P2, sender_type: 'admin', body: 'Hello!', created_at: ago(40) },
    ],
  };
  const db = fakeDb(tables);
  let list = await loadConversations(db);
  const ada = list.find((c) => c.participant_id === P1);
  const bo = list.find((c) => c.participant_id === P2);
  assert.deepEqual([ada.waiting, ada.ringing, ada.status], [true, true, 'open']);
  assert.deepEqual([bo.waiting, bo.ringing, bo.status], [false, false, 'open'], 'replied, not handled yet');

  await setConversationState(db, P1, { ack_at: new Date().toISOString() });
  list = await loadConversations(db);
  assert.equal(list.find((c) => c.participant_id === P1).ringing, false, 'checked off');

  // A new message after the check-off rings again.
  tables.support_messages.push({ id: 'm4', participant_id: P1, sender_type: 'participant', body: 'Hello??', created_at: new Date(Date.now() + 1000).toISOString() });
  list = await loadConversations(db);
  assert.equal(list.find((c) => c.participant_id === P1).ringing, true);

  await setConversationState(db, P1, { handled_at: new Date(Date.now() + 2000).toISOString() });
  list = await loadConversations(db);
  assert.deepEqual([list.find((c) => c.participant_id === P1).status, list.find((c) => c.participant_id === P1).ringing], ['handled', false]);
});

test('withdrawal requests are labelled; new messages go to Telegram once; reminders repeat only after the interval', async () => {
  const db = fakeDb({
    participants: people,
    admin_conversations: [],
    admin_alert_config: [{ id: true, enabled: true, telegram_bot_token: '1:x', telegram_chat_id: '9', reminder_minutes: 15, max_reminders: 24, digest_hour: 23, timezone: 'Africa/Lagos', last_digest_on: '2999-01-01' }],
    support_messages: [
      { id: 'w1', participant_id: P1, withdrawal_id: 'wd', sender_type: 'participant', body: 'Withdrawal request: $20.00', created_at: ago(20), tg_status: 'none', tg_attempts: 0 },
    ],
  });
  const sent = telegram();
  await queueAdminTelegram(db, 'w1');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Withdrawal from @ada/);
  assert.equal((await db.from('support_messages').select()).data[0].tg_status, 'sent');

  await runAdminAlertSweep(db); // waiting 20 min > 15: first reminder
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /Reminder: 1 message still waiting/);
  await runAdminAlertSweep(db); // just reminded: nothing
  assert.equal(sent.length, 2);
  const [c] = await loadConversations(db);
  assert.deepEqual([c.label, c.reminder_count], ['Withdrawal', 1]);
});

test('a failed Telegram send stays pending and is retried later', async () => {
  const db = fakeDb({
    participants: people,
    admin_alert_config: [{ id: true, enabled: true, telegram_bot_token: '1:x', telegram_chat_id: '9', reminder_minutes: 15, digest_hour: 23, last_digest_on: '2999-01-01' }],
    support_messages: [{ id: 'm1', participant_id: P1, sender_type: 'participant', body: 'Hi', created_at: ago(1), tg_status: 'none', tg_attempts: 0 }],
  });
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, description: 'Bad Gateway' }) });
  await queueAdminTelegram(db, 'm1');
  const [m] = (await db.from('support_messages').select()).data;
  assert.deepEqual([m.tg_status, m.tg_attempts, m.tg_error], ['pending', 1, 'Bad Gateway']);
  assert.ok(m.tg_next_try_at > new Date().toISOString(), 'backs off');
});

test('alerts off: nothing is sent', async () => {
  const db = fakeDb({ admin_alert_config: [{ id: true, enabled: false }], support_messages: [] });
  const sent = telegram();
  assert.deepEqual(await runAdminAlertSweep(db), { sent: false, reason: 'alerts off' });
  assert.equal(sent.length, 0);
});
