// Isolated route checks with real JWT verification and an in-memory query double.
// No environment files, remote databases, or live messages are used.
// Run: node --test scripts/test-message-routes.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import jwt from 'jsonwebtoken';

const secret = 'message-route-test-secret-at-least-thirty-two-characters';
const sender = '11111111-1111-4111-8111-111111111111';
const receiver = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';
const compiled = new Map();

function load(relativePath, dependencies) {
  if (!compiled.has(relativePath)) {
    compiled.set(relativePath, transformSync(
      fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'),
      { loader: relativePath.endsWith('.ts') ? 'ts' : 'js', format: 'cjs' },
    ).code);
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(relativePath), {
    module, exports: module.exports, console,
    process: { env: { JWT_SECRET: secret, SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
    require(name) {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}

function participantToken(id, options = {}) {
  return jwt.sign({ userId: id, type: 'onedream' }, secret, { expiresIn: '1h', ...options });
}

function fixture() {
  const messages = [{ id: messageId, sender_id: sender, receiver_id: receiver, content: 'Hello', is_read: false }];
  const participants = [sender, receiver, other].map(id => ({ id }));
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(table);
      const rows = table === 'messages' ? messages : table === 'participants' ? participants : null;
      assert.ok(rows, `Unexpected table: ${table}`);
      const filters = [];
      let update;
      const finish = () => {
        const row = rows.find(item => filters.every(([key, value]) => item[key] === value));
        if (row && update) Object.assign(row, update);
        return { data: row ? { ...row } : null, error: null };
      };
      const query = {
        select() { return query; },
        update(value) { update = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        single: async () => finish(),
        maybeSingle: async () => finish(),
        // Conversation tests exercise the response contract; fixtures already
        // contain only the selected conversation, without simulating PostgREST.
        or() { return query; },
        order() { return query; },
        limit: async () => ({ data: structuredClone(rows), error: null }),
      };
      return query;
    },
  };
  const supabaseModule = { createClient: () => supabase };
  const jwtHelper = load('lib/jwtSecret.js', { jsonwebtoken: jwt });
  const participantAuth = load('lib/participantAuth.js', {
    jsonwebtoken: jwt,
    '@supabase/supabase-js': supabaseModule,
    './jwtSecret': jwtHelper,
  });
  const read = load('pages/api/messages/[id]/read.ts', {
    '@supabase/supabase-js': supabaseModule,
    '../../../../lib/participantAuth': participantAuth,
  }).default;
  const conversation = load('pages/api/messages/conversation.ts', {
    '@supabase/supabase-js': supabaseModule,
    '../../../lib/jwtSecret': jwtHelper,
  }).default;
  return { messages, participants, calls, read, conversation };
}

async function invoke(handler, { token, method = 'PATCH', id = messageId, headers = {} } = {}) {
  const response = {
    status(code) { this.code = code; return this; },
    json(body) { this.body = structuredClone(body); return this; },
  };
  await handler({
    method, query: { id },
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  }, response);
  return response;
}

test('the intended receiver can mark a message read repeatedly using the current participant JWT', async () => {
  const store = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await invoke(store.read, { token: participantToken(receiver) });
    assert.equal(response.code, 200);
    assert.equal(response.body.message.id, messageId);
    assert.equal(response.body.message.is_read, true);
    assert.equal(store.messages[0].is_read, true);
  }
});

for (const [name, id] of [['sender', sender], ['unrelated participant', other]]) {
  test(`${name} cannot change another participant's read receipt`, async () => {
    const store = fixture();
    const response = await invoke(store.read, { token: participantToken(id) });
    assert.equal(response.code, 404);
    assert.equal(response.body.error, 'Message not found');
    assert.equal(store.messages[0].is_read, false);
  });
}

for (const [name, token] of [
  ['missing', undefined],
  ['invalid', 'invalid-token'],
  ['expired', participantToken(receiver, { expiresIn: -1 })],
  ['merchant', jwt.sign({ id: receiver, type: 'merchant' }, secret)],
]) {
  test(`${name} token is rejected before any message query`, async () => {
    const store = fixture();
    const response = await invoke(store.read, { token });
    assert.equal(response.code, 401);
    assert.ok(!store.calls.includes('messages'));
    assert.equal(store.messages[0].is_read, false);
  });
}

test('a removed participant cannot use an otherwise valid token', async () => {
  const store = fixture();
  store.participants.splice(store.participants.findIndex(item => item.id === receiver), 1);
  const response = await invoke(store.read, { token: participantToken(receiver) });
  assert.equal(response.code, 401);
  assert.ok(!store.calls.includes('messages'));
});

test('an unknown message returns the same 404 as a message belonging to someone else', async () => {
  const store = fixture();
  const response = await invoke(store.read, { token: participantToken(receiver), id: other });
  assert.equal(response.code, 404);
  assert.equal(response.body.error, 'Message not found');
  assert.equal(store.messages[0].is_read, false);
});

test('invalid route parameters and unsupported methods never update messages', async () => {
  for (const options of [{ id: '' }, { id: [messageId] }, { method: 'GET' }]) {
    const store = fixture();
    const response = await invoke(store.read, { token: participantToken(receiver), ...options });
    assert.equal(response.code, options.method ? 405 : 400);
    assert.ok(!store.calls.includes('messages'));
  }
});

for (const empty of [false, true]) {
  test(`conversation GET is consumed by the unchanged mobile helper (${empty ? 'empty' : 'populated'})`, async () => {
    const store = fixture();
    if (empty) store.messages.length = 0;
    const mobile = load('mobile/src/api/messages-p2p.ts', {
      '../lib/api-client': {
        async apiFetch(path, options) {
          assert.equal(path, '/api/messages/conversation');
          const response = await invoke(store.conversation, {
            method: options.method, token: options.token,
            headers: { 'x-receiver-id': options.headers['X-Receiver-Id'] },
          });
          assert.equal(response.code, 200);
          assert.deepEqual(response.body, { messages: store.messages });
          return response.body;
        },
      },
    });
    assert.deepEqual(await mobile.getConversation(participantToken(sender), receiver), store.messages);
  });
}
