// Dream Coins & virtual gifts: rules + the real migration SQL in an isolated
// in-memory Postgres (PGlite). No remote database, Google or charges.
//   node --test scripts/test-dream-coins.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  evaluateCoinPurchase, evaluateProgram, giftErrorReply, orderAllowsAppreciation, processCoinPurchase,
  recognitionBadges, reversalForVoided, validateGiftRequest,
} from '../lib/dreamCoinsRules.js';

const buyer = '11111111-1111-4111-8111-111111111111';
const seller = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const LIMITS = [30, 50000];

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table participants (id uuid primary key, username text unique, name text);
  insert into participants values ('${buyer}', 'buyer', 'Buyer'), ('${seller}', 'seller', 'Seller'), ('${other}', 'other', 'Other');
`);
await db.exec(await fs.readFile(new URL('../supabase/add_dream_coins_gifting.sql', import.meta.url), 'utf8'));
test.after(() => db.close());

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const balance = async (id) => (await one('select balance from dream_coin_balances where participant_id = $1', [id]))?.balance ?? 0;
const credit = (token, quantity, participant = buyer, pkg = 'dream_coins_600') => one(
  'select dream_coins_credit_purchase($1, $2, $2, $3, null, $4, false, now()) as r', [participant, pkg, token, quantity]).then((row) => row.r);
const send = (requestId, { gift = 'support_star', quantity = 1, from = buyer, to = seller, limits = LIMITS } = {}) => one(
  `select virtual_gift_send($1, $2, $3, $4, $5, 'profile', null, false, null, false, $6, $7) as r`,
  [from, to, gift, quantity, requestId, ...limits]).then((row) => row.r);
const fails = async (promise, pattern) => assert.rejects(promise, (error) => pattern.test(error.message));

// Simulated Google Play + database-backed deps for processCoinPurchase.
function purchaseDeps(googleRecords, { enabled = true, consume = async () => 'consumed' } = {}) {
  const calls = { google: 0, consume: 0 };
  return {
    calls,
    enabled: () => enabled,
    findPackageByProduct: (productId) => one('select * from dream_coin_packages where google_play_product_id = $1', [productId]),
    findPurchaseByToken: (token) => one('select * from dream_coin_purchases where purchase_token = $1', [token]),
    getBalance: balance,
    async getPurchase(_productId, token) { calls.google += 1; return googleRecords[token]; },
    async consume(...args) { calls.consume += 1; return consume(...args); },
    async credit(input) {
      try {
        const row = await one('select dream_coins_credit_purchase($1, $2, $3, $4, $5, $6, $7, $8) as r',
          [input.participantId, input.packageId, input.productId, input.purchaseToken, input.orderId, input.quantity, input.isTest, input.purchasedAt]);
        return { row: row.r };
      } catch (error) {
        if (error.message.includes('purchase_owned_by_other_account')) return { conflict: true };
        throw error;
      }
    },
    recordConsumption: (token, state) => db.query('select dream_coins_record_consumption($1, $2)', [token, state]),
  };
}
const googleOk = (changes = {}) => ({ purchaseState: 0, obfuscatedExternalAccountId: buyer, orderId: 'GPA.1', purchaseTimeMillis: String(Date.now()), ...changes });

test('migration seeds exactly the seven coin products and passes its own verification query', async () => {
  const ids = (await db.query('select id, coins_per_unit from dream_coin_packages order by sort_order')).rows;
  assert.deepEqual(ids.map((p) => [p.id, p.coins_per_unit]), [
    ['dream_coins_100', 100], ['dream_coins_250', 250], ['dream_coins_600', 600], ['dream_coins_1300', 1300],
    ['dream_coins_2800', 2800], ['dream_coins_7500', 7500], ['dream_coins_16000', 16000],
  ]);
  const sql = await fs.readFile(new URL('../supabase/add_dream_coins_gifting.sql', import.meta.url), 'utf8');
  const checks = (await db.query(sql.slice(sql.lastIndexOf('with checks(')))).rows;
  assert.deepEqual(checks.filter((c) => !c.ok), []);
});

test('one purchase of three units credits exactly three units (1,800 coins), once', async () => {
  const deps = purchaseDeps({ 'tok-multi': googleOk({ quantity: 3 }) });
  const first = await processCoinPurchase({ participantId: buyer, productId: 'dream_coins_600', purchaseToken: 'tok-multi' }, deps);
  assert.equal(first.status, 200);
  assert.equal(first.body.quantity, 3);
  assert.equal(first.body.total_coins, 1800);
  assert.equal(first.body.consumption, 'consumed');
  assert.equal(await balance(buyer), 1800);

  // Duplicate callback / token resubmission: same answer, no new coins, Google not asked again.
  const again = await processCoinPurchase({ participantId: buyer, productId: 'dream_coins_600', purchaseToken: 'tok-multi' }, deps);
  assert.equal(again.status, 200);
  assert.equal(again.body.already_credited, true);
  assert.equal(again.body.total_coins, 1800);
  assert.equal(deps.calls.google, 1);
  assert.equal(await balance(buyer), 1800);
  assert.equal((await one(`select count(*)::int as n from dream_coin_ledger where entry_type = 'purchase_credit'`)).n, 1);

  // Someone else submitting the same token gets nothing.
  const thief = await processCoinPurchase({ participantId: other, productId: 'dream_coins_600', purchaseToken: 'tok-multi' }, deps);
  assert.equal(thief.status, 409);
  assert.equal(await balance(other), 0);
});

test('a single-unit purchase without a quantity field credits one unit', async () => {
  const deps = purchaseDeps({ 'tok-single': googleOk() });
  const result = await processCoinPurchase({ participantId: buyer, productId: 'dream_coins_100', purchaseToken: 'tok-single' }, deps);
  assert.equal(result.body.total_coins, 100);
  assert.equal(await balance(buyer), 1900);
});

test('pending, cancelled, unbound, foreign, unknown-product and switched-off purchases credit nothing', async () => {
  const before = await balance(buyer);
  const deps = purchaseDeps({
    pending: googleOk({ purchaseState: 2 }),
    cancelled: googleOk({ purchaseState: 1 }),
    unbound: googleOk({ obfuscatedExternalAccountId: undefined }),
    foreign: googleOk({ obfuscatedExternalAccountId: other }),
  });
  const run = (token, productId = 'dream_coins_250') => processCoinPurchase({ participantId: buyer, productId, purchaseToken: token }, deps);
  assert.equal((await run('pending')).status, 202);
  assert.equal((await run('cancelled')).status, 400);
  assert.equal((await run('unbound')).status, 400);
  assert.equal((await run('foreign')).status, 409);
  assert.equal((await run('x', 'onedream_ad_starter')).status, 400);
  const off = await processCoinPurchase({ participantId: buyer, productId: 'dream_coins_250', purchaseToken: 'pending' }, purchaseDeps({}, { enabled: false }));
  assert.equal(off.status, 503);
  assert.equal(await balance(buyer), before);
  assert.equal(deps.calls.consume, 0);
});

test('interrupted processing: credited but consume failed is retried on the next submission', async () => {
  let fail = true;
  const deps = purchaseDeps({ 'tok-retry': googleOk({ quantity: 2 }) }, { consume: async () => { if (fail) throw new Error('network'); return 'consumed'; } });
  const first = await processCoinPurchase({ participantId: buyer, productId: 'dream_coins_250', purchaseToken: 'tok-retry' }, deps);
  assert.equal(first.body.total_coins, 500);
  assert.equal(first.body.consumption, 'failed');
  assert.equal((await one(`select consumption_state from dream_coin_purchases where purchase_token = 'tok-retry'`)).consumption_state, 'failed');
  fail = false;
  const retry = await processCoinPurchase({ participantId: buyer, productId: 'dream_coins_250', purchaseToken: 'tok-retry' }, deps);
  assert.equal(retry.body.already_credited, true);
  assert.equal(retry.body.consumption, 'consumed');
  assert.equal((await one(`select consumption_state from dream_coin_purchases where purchase_token = 'tok-retry'`)).consumption_state, 'consumed');
});

test('concurrent submissions of different purchases both credit; the same purchase credits once', async () => {
  const start = await balance(other);
  await Promise.all([credit('tok-c1', 1, other, 'dream_coins_100'), credit('tok-c2', 1, other, 'dream_coins_100'), credit('tok-c1', 1, other, 'dream_coins_100')]);
  assert.equal(await balance(other), start + 200);
});

test('gift sending: atomic deduction, idempotent retry, server-side price, limits and refusals', async () => {
  const start = await balance(buyer);
  const sent = await send('req-00000001', { quantity: 3 });
  assert.equal(sent.coins_spent, 150);
  assert.equal(await balance(buyer), start - 150);

  const retry = await send('req-00000001', { quantity: 3 });
  assert.equal(retry.already_sent, true);
  assert.equal(await balance(buyer), start - 150);

  await fails(send('req-00000002', { to: buyer }), /self_gifting/);
  await fails(send('req-00000003', { gift: 'no_such_gift' }), /gift_unavailable/);
  await fails(send('req-00000004', { quantity: 100 }), /invalid_quantity/);
  await fails(send('req-00000005', { limits: [1, 50000] }), /rate_limited/);
  await fails(send('req-00000006', { limits: [30, 160] }), /daily_limit/);
  await fails(send('req-00000007', { from: seller, to: buyer }), /insufficient_coins/);
  await fails(send('req-00000008', { gift: 'legendary_support', quantity: 40 }), /insufficient_coins/);

  await db.query(`update virtual_gift_catalogue set is_active = false where id = 'golden_trophy'`);
  await fails(send('req-00000009', { gift: 'golden_trophy' }), /gift_unavailable/);
  await db.query(`update virtual_gift_catalogue set is_active = true where id = 'golden_trophy'`);

  const admin = '44444444-4444-4444-8444-444444444444';
  await db.query('select dream_coins_set_suspension($1, true, $2, $3)', [buyer, 'review', admin]);
  await fails(send('req-00000010'), /account_suspended/);
  await db.query('select dream_coins_set_suspension($1, false, $2, $3)', [buyer, 'cleared', admin]);
  assert.equal((await one(`select count(*)::int as n from dream_gifting_admin_audit where action in ('suspend_gifting', 'restore_gifting')`)).n, 2);
});

test('admin gift reversal returns coins once and removes recognition', async () => {
  const before = await balance(buyer);
  const sent = await send('req-rev-0001', { gift: 'thank_you_rose' });
  const admin = '44444444-4444-4444-8444-444444444444';
  const reversed = (await one('select virtual_gift_reverse($1, $2, $3) as r', [sent.gift_transaction_id, admin, 'abuse test'])).r;
  assert.equal(reversed.coins_returned, 25);
  assert.equal((await one('select virtual_gift_reverse($1, $2, $3) as r', [sent.gift_transaction_id, admin, 'again'])).r.already_reversed, true);
  assert.equal(await balance(buyer), before);
  assert.equal((await one('select status from virtual_gift_transactions where id = $1', [sent.gift_transaction_id])).status, 'reversed');
});

test('refunds: partial quantity, full remainder, replay-safe, and spent coins leave a blocking debt', async () => {
  const before = await balance(buyer);
  const rev = (quantity, key) => one(`select dream_coins_reverse_purchase('tok-multi', $1, $2, 'test') as n`, [quantity, key]).then((r) => r.n);
  assert.equal(await rev(1, 'evt-1'), 600);
  assert.equal(await rev(1, 'evt-1'), 0); // same Google event again
  assert.equal((await one(`select status, reversed_quantity from dream_coin_purchases where purchase_token = 'tok-multi'`)).status, 'partially_reversed');
  assert.equal(await rev(null, 'evt-2'), 1200); // full refund reverses only what is left
  assert.equal(await rev(null, 'evt-3'), 0);
  assert.equal((await one(`select status from dream_coin_purchases where purchase_token = 'tok-multi'`)).status, 'reversed');
  assert.equal(await balance(buyer), before - 1800);

  // Reverse the remaining purchases too so the account is in debt.
  await one(`select dream_coins_reverse_purchase('tok-single', null, 'e', 'test')`);
  await one(`select dream_coins_reverse_purchase('tok-retry', null, 'e', 'test')`);
  assert.ok(await balance(buyer) < 0);
  await fails(send('req-debt-0001', { gift: 'appreciation_heart' }), /insufficient_coins/);
  assert.equal(await one(`select dream_coins_reverse_purchase('unknown-token', null, 'e', 'x') as n`).then((r) => r.n), 0);
});

test('ledger, refunds and audit are append-only; balances always match the ledger', async () => {
  await fails(db.query('update dream_coin_ledger set coins = 1'), /append_only/);
  await fails(db.query('delete from dream_coin_ledger'), /append_only/);
  await fails(db.query('delete from dream_gifting_admin_audit'), /append_only/);
  const mismatched = (await db.query(`
    select b.participant_id from dream_coin_balances b
    left join (select participant_id, sum(coins) as total from dream_coin_ledger group by participant_id) l using (participant_id)
    where b.balance <> coalesce(l.total, 0)`)).rows;
  assert.deepEqual(mismatched, []);
});

test('admin adjustments are idempotent per request key', async () => {
  const admin = '44444444-4444-4444-8444-444444444444';
  const before = await balance(seller);
  await one('select dream_coins_admin_adjust($1, 50, $2, $3, $4)', [seller, 'goodwill', admin, 'adj-0001']);
  const again = (await one('select dream_coins_admin_adjust($1, 50, $2, $3, $4) as r', [seller, 'goodwill', admin, 'adj-0001'])).r;
  assert.equal(again.already_applied, true);
  assert.equal(await balance(seller), before + 50);
});

test('reward programmes cannot be monetary', async () => {
  await fails(db.query(`insert into reward_programs (id, name, is_monetary) values ('cash_bonus', 'Cash bonus', true)`), /reward_programs_non_cash/);
});

test('client roles have no access to coin tables or functions', async () => {
  const row = await one(`select
    has_table_privilege('anon', 'dream_coin_ledger', 'select') as anon_ledger,
    has_table_privilege('authenticated', 'dream_coin_balances', 'update') as auth_balances,
    has_function_privilege('authenticated', 'dream_coins_reverse_purchase(text,integer,text,text)', 'execute') as auth_reverse`);
  assert.deepEqual(row, { anon_ledger: false, auth_balances: false, auth_reverse: false });
});

test('rules: quantity comes from Google, refunds map per event, requests are validated', () => {
  assert.deepEqual(evaluateCoinPurchase(googleOk({ quantity: 5 }), buyer), { ok: true, quantity: 5, isTest: false });
  assert.equal(evaluateCoinPurchase(googleOk({ quantity: 0 }), buyer).ok, false);
  assert.equal(evaluateCoinPurchase(googleOk({ quantity: 2, refundableQuantity: 0 }), buyer).ok, false);
  assert.equal(evaluateCoinPurchase(googleOk({ purchaseType: 0 }), buyer).isTest, true);

  assert.deepEqual(reversalForVoided({ purchaseToken: 't', refundType: 2, voidedQuantity: 2, voidedTimeMillis: '9', orderId: 'GPA' }), { purchaseToken: 't', quantity: 2, eventKey: '9:GPA' });
  assert.equal(reversalForVoided({ purchaseToken: 't', refundType: 1, voidedTimeMillis: '9' }).quantity, null);

  const ok = validateGiftRequest({ recipient_username: '@Seller', gift_id: 'support_star', quantity: 2, client_request_id: 'abcdefgh12', coin_cost: 1 });
  assert.equal(ok.ok, true);
  assert.equal('coin_cost' in ok.value, false);
  assert.equal(validateGiftRequest({ recipient_username: 'x', gift_id: 'support_star', client_request_id: 'short' }).ok, false);
  assert.equal(validateGiftRequest({ recipient_username: 'x', gift_id: 'support_star', client_request_id: 'abcdefgh12', message: 'x'.repeat(141) }).ok, false);

  const order = { status: 'buyer_confirmed', buyer_token: 'tokentoken', seller_username: 'seller' };
  assert.equal(orderAllowsAppreciation(order, { buyerToken: 'tokentoken', sellerUsername: 'Seller' }).ok, true);
  assert.equal(orderAllowsAppreciation({ ...order, status: 'paid' }, { buyerToken: 'tokentoken', sellerUsername: 'seller' }).ok, false);
  assert.equal(orderAllowsAppreciation(order, { buyerToken: 'wrong', sellerUsername: 'seller' }).ok, false);
  assert.equal(orderAllowsAppreciation(order, { buyerToken: 'tokentoken', sellerUsername: 'someone' }).ok, false);

  assert.equal(giftErrorReply('ERROR: insufficient_coins').status, 402);
  assert.equal(giftErrorReply('something else'), null);
  assert.deepEqual(recognitionBadges(600, 12).map((b) => b.id), ['first_thanks', 'appreciated', 'ten_supporters']);

  assert.equal(evaluateProgram({ criteria: { metric: 'confirmed_sales', threshold: 10 } }, { confirmed_sales: 12 }).status, 'eligible');
  assert.equal(evaluateProgram({ criteria: { metric: 'merchant_referrals', threshold: 3 } }, { confirmed_sales: 12 }).status, 'not_tracked');
  assert.equal(evaluateProgram({ criteria: { metric: 'delivery_reliability', threshold: 0.95, min_orders: 5 } }, { delivery_reliability: 1, total_orders: 2 }).status, 'in_progress');
  assert.equal(evaluateProgram({ criteria: { metric: 'admin_review' } }, {}).status, 'admin_review');
});
