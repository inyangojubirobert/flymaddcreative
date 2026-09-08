// Run: node --experimental-vm-modules --test scripts/test-ai-subscription-currency.mjs
// Isolated provider/database doubles: no credentials, network requests, or charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { subscriptionTestStore, closeSubscriptionTestStore } from './lib/subscription-test-store.mjs';
test.after(closeSubscriptionTestStore);

const participant = { id: '11111111-1111-4111-8111-111111111111', username: 'alice', email: 'alice@example.test' };

function database() {
  const tables = { participants: [participant], ai_subscription_transactions: [], ai_subscriptions: [], ai_provider_subscriptions: [] };
  let sequence = 0;
  const db = {
    tables, failWrites: false,
    from(table) {
      const filters = [];
      let order, limit, write;
      function execute(single = false) {
        if (write && db.failWrites) return { data: null, error: { code: '42P01' } };
        let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
        if (write?.type === 'upsert') {
          const keys = write.conflict.split(',');
          let row = tables[table].find((item) => keys.every((key) => item[key] === write.row[key]));
          if (!row) {
            row = { id: String(++sequence), created_at: new Date(sequence * 1000).toISOString() };
            tables[table].push(row);
          }
          Object.assign(row, structuredClone(write.row));
          return { data: null, error: null };
        }
        if (write?.type === 'update') rows.forEach((row) => Object.assign(row, write.row));
        if (order) rows = [...rows].sort((a, b) => String(b[order]).localeCompare(String(a[order])));
        if (limit) rows = rows.slice(0, limit);
        return { data: structuredClone(single ? rows[0] || null : rows), error: null };
      }
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        is(key, value) { filters.push((row) => (row[key] ?? null) === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        order(key) { order = key; return query; },
        limit(value) { limit = value; return query; },
        maybeSingle() { return Promise.resolve(execute(true)); },
        upsert(row, { onConflict }) { write = { type: 'upsert', row, conflict: onConflict }; return query; },
        update(row) { write = { type: 'update', row }; return query; },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  return db;
}

async function harness() {
  const db = database();
  const store = await subscriptionTestStore([participant.id]);
  db.rpc = async (name, input) => {
    const result = await store.rpc(name, input);
    if (!result.error) {
      db.tables.ai_subscriptions = JSON.parse(JSON.stringify((await store.sql.query('select * from ai_subscriptions')).rows));
      db.tables.ai_provider_subscriptions = JSON.parse(JSON.stringify((await store.sql.query('select * from ai_provider_subscriptions')).rows));
    }
    return result;
  };
  const state = { rate: 1475.25, rateCalls: 0, requests: [], plans: [], transactions: new Map() };
  const env = { PAYSTACK_SECRET_KEY: 'test-only-secret', AI_SUBSCRIPTION_NGN_PER_USD: '9999' };
  const context = vm.createContext({
    console: { ...console, error() {} }, Buffer, process: { env },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      state.requests.push({ url, method: options.method || 'GET', body });
      let data;
      if (url.startsWith('https://api.paystack.co/plan?')) data = state.plans;
      else if (url.startsWith('https://api.paystack.co/plan/')) data = state.plans.find((plan) => url.endsWith(plan.plan_code));
      else if (url === 'https://api.paystack.co/plan' && options.method === 'POST') {
        data = { ...body, plan_code: `PLN_${state.plans.length + 1}` };
        state.plans.push(data);
      } else if (url.endsWith('/transaction/initialize')) {
        assert.ok(db.tables.ai_subscription_transactions.some((row) => row.provider_reference === body.reference && row.status === 'pending'));
        data = { authorization_url: 'https://checkout.paystack.test/quote', reference: body.reference };
        state.transactions.set(body.reference, {
          ...body, status: 'success', paid_at: '2026-09-06T10:00:00.000Z',
          plan: state.plans.find((plan) => plan.plan_code === body.plan), customer: { email: participant.email },
        });
      } else if (url.startsWith('https://api.paystack.co/transaction/verify/')) data = state.transactions.get(decodeURIComponent(url.split('/').at(-1)));
      else throw new Error(`Unexpected external request: ${url}`);
      return { ok: !!data, json: async () => ({ status: !!data, data }) };
    },
  });
  const synthetic = (values) => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const mocks = {
    crypto: synthetic({ default: crypto }),
    'google-auth-library': synthetic({ GoogleAuth: class {}, OAuth2Client: class {} }),
    '@supabase/supabase-js': synthetic({ createClient: () => db }),
    currency: synthetic({
      getUsdToNgnRate: async () => { state.rateCalls++; return state.rate; },
      usdToKobo: (usd, rate) => Math.round(usd * rate * 100),
      usdToNgn: (usd, rate) => Math.round(usd * rate * 100) / 100,
    }),
  };
  const modules = new Map();
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    const module = new vm.SourceTextModule(await fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8'), { context });
    modules.set(path, module);
    await module.link((specifier) => mocks[specifier]
      || (specifier.endsWith('/currency') ? mocks.currency : load(`lib/${specifier.split('/').at(-1)}.js`)));
    await module.evaluate();
    return module;
  }
  const api = (await load('lib/aiPayments.js')).namespace;
  const handler = (await load('pages/api/onedream/ai-subscription/paystack-webhook.js')).namespace.default;
  async function webhook(event, data) {
    const body = { event, data };
    const signature = crypto.createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(JSON.stringify(body)).digest('hex');
    const response = { code: null, status(code) { this.code = code; return this; }, json() { return this; } };
    await handler({ method: 'POST', body, headers: { 'x-paystack-signature': signature } }, response);
    return response.code;
  }
  const checkout = (plan = 'pro') => api.initializePaystackAiSubscription(db, participant, plan, 'https://example.test/return');
  return { api, db, state, env, checkout, webhook };
}

test('new quotes use the shared converter and ignore the obsolete fixed-rate setting', async () => {
  const { api, state } = await harness();
  const pro = await api.getPaystackAiAmount('pro');
  const business = await api.getPaystackAiAmount('business');
  assert.equal(pro.amountMinor, 1327725);
  assert.equal(pro.amountNgn, 13277.25);
  assert.equal(business.amountMinor, 2950500);
  assert.equal(state.rateCalls, 2);
  state.rate = 0;
  await assert.rejects(api.getPaystackAiAmount('pro'), /invalid_ai_subscription_rate/);
});

test('checkout persists an immutable amount before returning a provider URL', async () => {
  const { checkout, db, state } = await harness();
  const result = await checkout();
  const stored = db.tables.ai_subscription_transactions[0];
  assert.equal(stored.provider_reference, result.reference);
  assert.equal(stored.amount_minor, 1327725);
  assert.equal(stored.status, 'pending');
  assert.equal(result.exchangeRate, 1475.25);
  assert.equal(state.transactions.get(result.reference).metadata.exchange_rate, 1475.25);
  assert.equal(db.tables.ai_subscriptions.length, 0);
});

test('checkout fails before offering payment if quote storage is unavailable', async () => {
  const { checkout, db, state } = await harness();
  db.failWrites = true;
  await assert.rejects(checkout(), (error) => error.code === '42P01');
  assert.equal(state.requests.filter((request) => request.url.endsWith('/transaction/initialize')).length, 0);
});

test('a configured plan with an old NGN price is not reused or repriced', async () => {
  const { checkout, env, state } = await harness();
  env.PAYSTACK_AI_PRO_PLAN_CODE = 'PLN_old';
  state.plans.push({ plan_code: 'PLN_old', name: 'Bascardo AI Pro Monthly', amount: 1440000, currency: 'NGN', interval: 'monthly' });
  const result = await checkout();
  assert.notEqual(result.planCode, 'PLN_old');
  assert.equal(state.plans[0].amount, 1440000);
  assert.equal(state.requests.some((request) => request.method === 'PUT'), false);
});

test('payment verification succeeds after the conversion rate changes', async () => {
  const { api, checkout, state, db } = await harness();
  const result = await checkout();
  state.rate = 2000;
  const callsBefore = state.requests.length;
  const entitlement = await api.activateVerifiedPaystackSubscription(db, participant, state.transactions.get(result.reference));
  assert.equal(entitlement.plan.id, 'pro');
  assert.equal(state.rateCalls, 1);
  assert.equal(state.requests.length, callsBefore);
  assert.equal(db.tables.ai_subscriptions[0].status, 'active');
});

test('underpayment, wrong currency/account/plan, and failed charges do not activate', async () => {
  for (const alteration of [
    { amount: 1 }, { currency: 'USD' }, { status: 'failed' },
    { plan: { plan_code: 'PLN_other' } },
    { metadata: { type: 'bascardo_ai_subscription', participant_id: 'another-user', ai_plan: 'pro' } },
  ]) {
    const { api, checkout, state, db } = await harness();
    const result = await checkout();
    await assert.rejects(api.activateVerifiedPaystackSubscription(db, participant, { ...state.transactions.get(result.reference), ...alteration }), /payment_/);
    assert.equal(db.tables.ai_subscriptions.length, 0);
  }
});

test('provider metadata cannot invent a checkout quote', async () => {
  const { api, db } = await harness();
  await assert.rejects(api.activateVerifiedPaystackSubscription(db, participant, {
    reference: 'invented', amount: 1, currency: 'NGN', status: 'success',
    metadata: { type: 'bascardo_ai_subscription', participant_id: participant.id, ai_plan: 'pro', exchange_rate: 0.01 },
  }), /payment_quote_not_found/);
});

test('subscription creation binds the saved quote without granting access; invoice renewals retain its price', async () => {
  const { checkout, state, db, webhook } = await harness();
  const result = await checkout();
  const plan = state.plans[0];
  const subscription = { subscription_code: 'SUB_1', next_payment_date: '2026-11-06T10:00:00.000Z' };
  const created = { ...subscription, plan, amount: plan.amount, customer: { email: participant.email } };
  assert.equal(await webhook('subscription.create', created), 200);
  assert.equal(db.tables.ai_subscriptions.length, 0);
  assert.equal(db.tables.ai_subscription_transactions[0].provider_subscription_id, 'SUB_1');
  assert.equal(await webhook('charge.success', { reference: result.reference }), 200);
  assert.equal(db.tables.ai_subscriptions[0].provider_reference, 'SUB_1');

  state.rate = 2000;
  state.transactions.set('renewal', {
    reference: 'renewal', status: 'success', amount: plan.amount, currency: 'NGN',
    paid_at: '2026-10-06T10:00:00.000Z', plan, customer: { email: participant.email },
  });
  const invoice = { paid: true, subscription, transaction: { reference: 'renewal' } };
  assert.equal(await webhook('invoice.update', invoice), 200);
  assert.equal(await webhook('invoice.update', invoice), 200);
  assert.equal(state.rateCalls, 1);
  assert.equal(db.tables.ai_subscription_transactions.filter((row) => row.provider_reference === 'renewal').length, 1);
  assert.equal(db.tables.ai_subscriptions[0].current_period_end, '2026-11-06T10:00:00.000Z');
});

test('a repeated subscription.create cannot attach its code to a later checkout', async () => {
  const { checkout, state, db, webhook } = await harness();
  await checkout();
  const created = { subscription_code: 'SUB_1', plan: state.plans[0], amount: state.plans[0].amount, customer: { email: participant.email } };
  assert.equal(await webhook('subscription.create', created), 200);
  await checkout();
  assert.equal(await webhook('subscription.create', created), 200);
  assert.equal(db.tables.ai_subscription_transactions.filter((row) => row.provider_subscription_id === 'SUB_1').length, 1);
});
