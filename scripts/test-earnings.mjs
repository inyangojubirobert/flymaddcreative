// Gift revenue sharing, affiliate marketplace and payouts: the real migration
// SQL in an isolated in-memory Postgres (PGlite) plus the JS rules.
// No remote database, Google, Paystack or money involved.
//   node --test scripts/test-earnings.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsTestDb } from './lib/earnings-test-db.mjs';
import {
  coinRowsOnly, emailHash, giftSplit, parsePlayEarningsReport, resaleSplit, sellerFundedImpact,
  signAttributionToken, validateOffer, verifyAttributionToken,
} from '../lib/earningsRules.js';

const { db, verification } = await earningsTestDb();
test.after(() => db.close());

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MERCHANT = id(900);
const MERCHANT_LINK = id(901);
const OTHER_MERCHANT = id(902);
const ADMIN = id(999);
const buyer = id(1);
const creator = id(2);            // referred by MERCHANT, registered now
const oldCreator = id(3);         // referred by MERCHANT, registered 12 months ago
const plainCreator = id(4);       // not referred
const seller = id(5);             // marketplace seller, referred by MERCHANT
const partnerP = id(6);           // affiliate partner participant
const merchantPerson = id(7);     // participant linked to MERCHANT

await db.exec(`
  insert into referral_merchants values ('${MERCHANT}', 'Merch', 'merchant@example.com'), ('${OTHER_MERCHANT}', 'Other', 'other@example.com');
  insert into merchant_referral_links values ('${MERCHANT_LINK}', '${MERCHANT}', 'MERCH-1');
  insert into participants (id, username, name, email, created_at, referred_by_merchant_link_id) values
    ('${buyer}', 'buyer', 'Buyer', 'buyer@example.com', now(), null),
    ('${creator}', 'creator', 'Creator', 'creator@example.com', now(), '${MERCHANT_LINK}'),
    ('${oldCreator}', 'oldcreator', 'Old', 'old@example.com', now() - interval '12 months', '${MERCHANT_LINK}'),
    ('${plainCreator}', 'plain', 'Plain', 'plain@example.com', now(), null),
    ('${seller}', 'seller', 'Seller', 'seller@example.com', now(), '${MERCHANT_LINK}'),
    ('${partnerP}', 'partner', 'Partner', 'partner@example.com', now(), null),
    ('${merchantPerson}', 'merchperson', 'MP', 'mp@example.com', now(), null);
  insert into merchant_participant_links values ('${MERCHANT}', '${merchantPerson}', now());
`);

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const fails = (promise, pattern) => assert.rejects(promise, (e) => pattern.test(e.message));
const setting = (sql) => db.query(`update earnings_settings set ${sql} where id`);
const credit = (participant, token, pkg, qty = 1, isTest = false, orderId = null) => one(
  `select dream_coins_credit_purchase($1, $2, $2, $3, $4, $5, $6, now()) as r`, [participant, pkg, token, orderId ?? `GPA.${token}`, qty, isTest]).then((r) => r.r);
let req = 0;
const gift = (from, to, giftId, qty = 1) => one(
  `select virtual_gift_send($1, $2, $3, $4, $5, 'profile', null, false, null, false, 1000, 10000000) as r`,
  [from, to, giftId, qty, `req-${String(++req).padStart(8, '0')}`]).then((r) => r.r);
const bal = async (partyType, party, source) => {
  const rows = await all('select * from partner_balances($1, $2)', [partyType, party]);
  const row = rows.find((r) => r.source === source) || { pending: 0, available: 0, reserved: 0, paid: 0 };
  return { pending: Number(row.pending), available: Number(row.available), reserved: Number(row.reserved), paid: Number(row.paid) };
};
const components = (giftId) => all('select * from gift_earning_components where gift_transaction_id = $1 order by provisional_value_micro', [giftId]);

test('all four migrations apply and pass their own verification', () => {
  for (const [name, rows] of Object.entries(verification)) assert.deepEqual(rows.filter((r) => !r.ok), [], name);
});

test('every coin package and quantity becomes a lot priced from its Play product price', async () => {
  const packs = await all('select id, coins_per_unit, reference_price_usd from dream_coin_packages order by sort_order');
  assert.equal(packs.length, 7);
  for (const [i, pkg] of packs.entries()) {
    const qty = (i % 3) + 1;
    await credit(plainCreator, `pkg-${pkg.id}`, pkg.id, qty);
    const lot = await one('select l.* from coin_lots l join dream_coin_purchases p on p.id = l.purchase_id where p.purchase_token = $1', [`pkg-${pkg.id}`]);
    const gross = Math.round(Number(pkg.reference_price_usd) * 1e6) * qty;
    assert.equal(lot.coins_total, pkg.coins_per_unit * qty, pkg.id);
    assert.equal(Number(lot.gross_micro), gross, pkg.id);
    assert.equal(Number(lot.provisional_net_micro), Math.floor(gross * 70 / 100), `${pkg.id}: 30% provisional fee`);
    assert.equal(lot.earning, true);
  }
});

test('gift earnings are off by default: lots are allocated, nothing becomes money', async () => {
  await credit(buyer, 'tok-off', 'dream_coins_100');
  const g = await gift(buyer, creator, 'golden_trophy');
  assert.equal((await all('select * from gift_lot_allocations where gift_transaction_id = $1', [g.gift_transaction_id])).length, 1);
  assert.equal(await one('select count(*)::int n from gift_earnings').then((r) => r.n), 0);
  await setting('gift_earnings_enabled = true');
});

let multiLotGift;
test('one gift funded by two lots: values per lot, 50 / 10 / 40 split for a referred recipient', async () => {
  // buyer has 0 left of lot 1 (100 coins spent); buy two more lots
  await credit(buyer, 'tok-a', 'dream_coins_100');          // $0.99 -> 100 coins
  await credit(buyer, 'tok-b', 'dream_coins_250', 2);       // 2 x $1.99 -> 500 coins
  const g = await gift(buyer, creator, 'dream_supporter', 1); // 250 coins: 100 from lot a, 150 from lot b
  multiLotGift = g.gift_transaction_id;
  const ge = await one('select * from gift_earnings where gift_transaction_id = $1', [g.gift_transaction_id]);
  assert.equal(ge.merchant_id, MERCHANT);
  assert.equal(Number(ge.merchant_percent), 10);
  const cs = await components(g.gift_transaction_id);
  assert.deepEqual(cs.map((c) => c.coins).sort((a, b) => a - b), [100, 150]);
  const lotA = Math.floor(990000 * 0.7);            // 100 of 100 coins of a $0.99 lot
  const lotB = Math.floor(Math.floor(3980000 * 0.7) * 150 / 500);
  assert.deepEqual(cs.map((c) => Number(c.provisional_value_micro)).sort((a, b) => a - b), [lotA, lotB].sort((a, b) => a - b));
  for (const c of cs) {
    const v = Number(c.provisional_value_micro);
    assert.equal(Number(c.recipient_micro) + Number(c.merchant_micro) + Number(c.platform_micro), v, 'shares add up exactly');
    assert.deepEqual({ r: Number(c.recipient_micro), m: Number(c.merchant_micro) }, { r: Math.floor(v / 2), m: Math.floor(v / 10) });
  }
  const r = await bal('participant', creator, 'gift_recipient');
  const m = await bal('merchant', MERCHANT, 'gift_referral');
  assert.equal(r.pending, cs.reduce((s, c) => s + Number(c.recipient_micro), 0));
  assert.equal(m.pending, cs.reduce((s, c) => s + Number(c.merchant_micro), 0));
  assert.equal(r.available, 0, 'nothing withdrawable before Google pays out');
});

test('no referring merchant: the platform keeps 50%', async () => {
  await credit(buyer, 'tok-c', 'dream_coins_600');
  const g = await gift(buyer, plainCreator, 'golden_trophy');
  const ge = await one('select * from gift_earnings where gift_transaction_id = $1', [g.gift_transaction_id]);
  assert.equal(ge.merchant_id, null);
  const [c] = await components(g.gift_transaction_id);
  assert.equal(Number(c.merchant_micro), 0);
  assert.equal(Number(c.platform_micro), Number(c.provisional_value_micro) - Number(c.recipient_micro));
});

test('merchant entitlement ends exactly 12 months after the recipient registered', async () => {
  const g = await gift(buyer, oldCreator, 'support_star');
  const ge = await one('select * from gift_earnings where gift_transaction_id = $1', [g.gift_transaction_id]);
  assert.equal(ge.merchant_id, null);
  assert.equal(ge.merchant_excluded_reason, 'entitlement_expired');
  await db.query(`update participants set created_at = now() - interval '12 months' + interval '1 minute' where id = $1`, [oldCreator]);
  const g2 = await gift(buyer, oldCreator, 'support_star');
  assert.equal((await one('select merchant_id from gift_earnings where gift_transaction_id = $1', [g2.gift_transaction_id])).merchant_id, MERCHANT);
  await db.query(`update participants set created_at = now() - interval '12 months' where id = $1`, [oldCreator]);
});

test('the referring merchant earns nothing on gifts it sends or receives through its own account', async () => {
  await db.query(`update participants set referred_by_merchant_link_id = $2 where id = $1`, [merchantPerson, MERCHANT_LINK]);
  await credit(merchantPerson, 'tok-mp', 'dream_coins_600');
  const g = await gift(merchantPerson, creator, 'support_star'); // merchant gifting its own referral: circular
  const ge = await one('select * from gift_earnings where gift_transaction_id = $1', [g.gift_transaction_id]);
  assert.equal(ge.merchant_id, null);
  assert.equal(ge.merchant_excluded_reason, 'merchant_is_party_to_gift');
});

test('test purchases and admin coins never create money', async () => {
  const fresh = id(20);
  await db.query(`insert into participants (id, username, email) values ($1, 'fresh', 'fresh@example.com')`, [fresh]);
  await credit(fresh, 'tok-test', 'dream_coins_600', 1, true);
  await one(`select dream_coins_admin_adjust($1, 500, 'promo', $2, 'adj-00000001')`, [fresh, ADMIN]);
  const g = await gift(fresh, creator, 'diamond_appreciation', 2); // 1000 coins from test + admin lots
  assert.equal(await one('select count(*)::int n from gift_earnings where gift_transaction_id = $1', [g.gift_transaction_id]).then((r) => r.n), 0);
  assert.equal(await one('select sum(coins)::int n from gift_lot_allocations where gift_transaction_id = $1', [g.gift_transaction_id]).then((r) => r.n), 1000);
});

test('retrying a gift never creates a second earning', async () => {
  await credit(buyer, 'tok-retry', 'dream_coins_100');
  const key = 'retry-key-0001';
  const send = () => one(`select virtual_gift_send($1, $2, 'support_star', 1, $3, 'profile', null, false, null, false, 1000, 10000000) as r`, [buyer, creator, key]);
  const first = (await send()).r;
  const again = (await send()).r;
  assert.equal(again.already_sent, true);
  assert.equal(await one('select count(*)::int n from gift_earnings where gift_transaction_id = $1', [first.gift_transaction_id]).then((r) => r.n), 1);
  assert.equal(await one('select count(*)::int n from gift_earning_components where gift_transaction_id = $1', [first.gift_transaction_id]).then((r) => r.n), 1);
});

test('a partial refund reverses only the gifts that lot paid for, most recent gift first, proportionally', async () => {
  const lotB = await one(`select l.* from coin_lots l join dream_coin_purchases p on p.id = l.purchase_id where p.purchase_token = 'tok-b'`);
  const lotAllocs = () => all('select * from gift_lot_allocations where lot_id = $1 order by created_at, gift_transaction_id', [lotB.id]);
  const totalOutstanding = async () => Number((await one(`select coalesce(sum((recipient_micro - reversed_recipient_micro) + (merchant_micro - reversed_merchant_micro)), 0)::bigint s
    from gift_earning_components`)).s);
  const ledgerTotal = async () => Number((await one(`select coalesce(sum(amount_micro), 0)::bigint s from partner_ledger where source in ('gift_recipient', 'gift_referral')`)).s);
  const otherLotsBefore = await all('select * from gift_earning_components where lot_id <> $1 order by gift_transaction_id, lot_id', [lotB.id]);

  // Refund 1 of the 2 units (250 coins): unspent coins first, then the latest gifts this lot paid for.
  const unspent = lotB.coins_remaining;
  await one(`select dream_coins_reverse_purchase('tok-b', 1, 'evt-b1', 'test refund')`);
  const spentReversed = Math.max(0, 250 - unspent);
  const reversed = (await lotAllocs()).reduce((n, a) => n + a.coins_reversed, 0);
  assert.equal(reversed, spentReversed);
  assert.deepEqual(await all('select * from gift_earning_components where lot_id <> $1 order by gift_transaction_id, lot_id', [lotB.id]), otherLotsBefore,
    'gifts paid from other lots are untouched');
  assert.equal(await ledgerTotal(), await totalOutstanding(), 'ledger equals outstanding shares');

  // Refund the rest; replaying the same Google event does nothing.
  await one(`select dream_coins_reverse_purchase('tok-b', null, 'evt-b2', 'test refund')`);
  await one(`select dream_coins_reverse_purchase('tok-b', null, 'evt-b2', 'test refund')`);
  const full = await one('select * from gift_earning_components where gift_transaction_id = $1 and lot_id = $2', [multiLotGift, lotB.id]);
  assert.equal(full.reversed_coins, full.coins);
  assert.equal(Number(full.reversed_recipient_micro), Number(full.recipient_micro));
  assert.ok((await lotAllocs()).every((a) => a.coins_reversed === a.coins));
  assert.equal((await one('select status from gift_earnings where gift_transaction_id = $1', [multiLotGift])).status, 'partially_reversed',
    'the part paid from lot a stands');
  assert.equal(await ledgerTotal(), await totalOutstanding());
});

test('Google earnings report reconciles lots at their real fee (15% or 30%) and taxes', async () => {
  const lotA = await one(`select l.* from coin_lots l join dream_coin_purchases p on p.id = l.purchase_id where p.purchase_token = 'tok-a'`);
  const lotC = await one(`select l.* from coin_lots l join dream_coin_purchases p on p.id = l.purchase_id where p.purchase_token = 'tok-c'`);
  const csv = [
    'Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Product id,Product Type,Sku Id,Hardware,Buyer Country,Buyer State,Buyer Postal Code,Buyer Currency,Amount (Buyer Currency),Currency Conversion Rate,Merchant Currency,Amount (Merchant Currency)',
    `${lotA.order_id},"Oct 20, 2026",10:00:00 AM PDT,,Charge,,100 Dream Coins,dream_coins_100,inapp,,,US,,,USD,0.99,1,USD,0.99`,
    `${lotA.order_id},"Oct 20, 2026",10:00:00 AM PDT,,Google fee,,100 Dream Coins,dream_coins_100,inapp,,,US,,,USD,-0.15,1,USD,-0.15`,
    `${lotC.order_id},"Oct 20, 2026",10:00:00 AM PDT,,Charge,,600 Dream Coins,dream_coins_600,inapp,,,NG,,,NGN,7500,0.000665,USD,4.99`,
    `${lotC.order_id},"Oct 20, 2026",10:00:00 AM PDT,,Google fee,,600 Dream Coins,dream_coins_600,inapp,,,NG,,,NGN,-2250,0.000665,USD,-1.50`,
    `${lotC.order_id},"Oct 20, 2026",10:00:00 AM PDT,VAT,Tax,,600 Dream Coins,dream_coins_600,inapp,,,NG,,,NGN,-560,0.000665,USD,-0.37`,
    `GPA.someone-else,"Oct 20, 2026",10:00:00 AM PDT,,Charge,,Starter Ads,onedream_ad_starter,inapp,,,US,,,USD,10,1,USD,10`,
  ].join('\n');
  const parsed = parsePlayEarningsReport(csv);
  assert.deepEqual(parsed.errors, []);
  const rows = coinRowsOnly(parsed.rows, ['dream_coins_100', 'dream_coins_600']);
  assert.equal(rows.length, 5);

  const before = await bal('participant', creator, 'gift_recipient');
  const res = (await one(`select play_settlement_import('2026-10', 'test.csv', $1::jsonb, $2) as r`, [JSON.stringify(rows), ADMIN])).r;
  assert.equal(res.rows_imported, 5);
  assert.equal(res.lots_reconciled, 2);
  const a2 = await one('select * from coin_lots where id = $1', [lotA.id]);
  assert.equal(Number(a2.settled_net_micro), 840000, '15% fee lot');
  const c2 = await one('select * from coin_lots where id = $1', [lotC.id]);
  assert.equal(Number(c2.settled_net_micro), 3120000, '30% fee + tax lot');

  // Lot a's component of the multi-lot gift is re-valued at $0.84 for 100/100 coins.
  const compA = await one('select * from gift_earning_components where gift_transaction_id = $1 and lot_id = $2', [multiLotGift, lotA.id]);
  assert.equal(Number(compA.final_value_micro), 840000);
  assert.equal(Number(compA.provisional_value_micro), Math.floor(990000 * 0.7), 'provisional value is kept');
  assert.equal(Number(compA.recipient_micro), 420000);
  const after = await bal('participant', creator, 'gift_recipient');
  assert.ok(after.pending > before.pending, 'the 15% lot was worth more than the 30% provisional estimate');

  // Re-importing the same report changes nothing.
  const again = (await one(`select play_settlement_import('2026-10', 'test.csv', $1::jsonb, $2) as r`, [JSON.stringify(rows), ADMIN])).r;
  assert.equal(again.rows_imported, 0);
  assert.deepEqual(await bal('participant', creator, 'gift_recipient'), after);

  // The ledger always equals the outstanding (unreversed) shares.
  const outstanding = await one(`select coalesce(sum(recipient_micro - reversed_recipient_micro), 0)::bigint s
    from gift_earning_components gc join gift_earnings g using (gift_transaction_id) where g.recipient_id = $1`, [creator]);
  assert.equal(after.pending + after.available, Number(outstanding.s));
});

test('earnings become withdrawable only when Google has paid out that report', async () => {
  const batch = await one(`select id from play_settlement_batches order by imported_at limit 1`);
  const before = await bal('participant', creator, 'gift_recipient');
  const res = (await one(`select play_settlement_mark_funds($1, $2, 'BANK-REF-1') as r`, [batch.id, ADMIN])).r;
  assert.ok(res.components_released > 0);
  const after = await bal('participant', creator, 'gift_recipient');
  assert.ok(after.available > 0);
  assert.equal(after.available + after.pending, before.available + before.pending, 'release only moves money between buckets');
  // Gifts paid from lots that are not yet in a paid-out report stay pending.
  assert.ok(after.pending > 0);
});

test('a refund after earnings were withdrawable leaves a traceable negative adjustment', async () => {
  const before = await bal('participant', creator, 'gift_recipient');
  await one(`select dream_coins_reverse_purchase('tok-a', null, 'evt-a', 'chargeback')`);
  const after = await bal('participant', creator, 'gift_recipient');
  assert.ok(after.available < before.available);
  const rows = await all(`select * from partner_ledger where party_id = $1 and entry_type = 'reverse' and bucket = 'available'`, [creator]);
  assert.ok(rows.length >= 1);
  await fails(db.query('delete from partner_ledger'), /append_only/);
});

test('an admin gift reversal reverses its earnings and returns coins to their lots', async () => {
  await credit(buyer, 'tok-rev', 'dream_coins_250');
  const lot = await one(`select l.* from coin_lots l join dream_coin_purchases p on p.id = l.purchase_id where p.purchase_token = 'tok-rev'`);
  const g = await gift(buyer, plainCreator, 'golden_trophy');
  const allocs = await all('select * from gift_lot_allocations where gift_transaction_id = $1', [g.gift_transaction_id]);
  const lotsBefore = await all('select id, coins_remaining from coin_lots where id = any($1::uuid[])', [allocs.map((a) => a.lot_id)]);
  const total = async () => { const b = await bal('participant', plainCreator, 'gift_recipient'); return b.pending + b.available; };
  const before = await total();
  await one(`select virtual_gift_reverse($1, $2, 'abuse')`, [g.gift_transaction_id, ADMIN]);
  const [c] = await components(g.gift_transaction_id);
  assert.equal(before - (await total()), Number(c.recipient_micro));
  const lotsAfter = await all('select id, coins_remaining from coin_lots where id = any($1::uuid[])', [allocs.map((a) => a.lot_id)]);
  for (const a of allocs) {
    const b = lotsBefore.find((x) => x.id === a.lot_id).coins_remaining;
    assert.equal(lotsAfter.find((x) => x.id === a.lot_id).coins_remaining, b + a.coins, 'coins back in the lot they came from');
  }
  assert.ok(lot);
});

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------
test('payouts: switched off, payee checks, available balance only, idempotent, reserve / paid / failed', async () => {
  // A fresh, settled set of gifts so this test has its own available balance.
  const payee = id(30);
  await db.query(`insert into participants (id, username, email) values ($1, 'payee', 'payee@example.com')`, [payee]);
  await credit(buyer, 'tok-po', 'dream_coins_1300', 1, false, 'GPA.payout-test');
  for (let i = 0; i < 13; i += 1) await gift(buyer, payee, 'golden_trophy');
  const lots = (await all(`select distinct gla.lot_id from gift_lot_allocations gla join virtual_gift_transactions t on t.id = gla.gift_transaction_id
                            where t.recipient_id = $1`, [payee])).map((r) => r.lot_id);
  const orders = (await all('select order_id from coin_lots where id = any($1::uuid[]) and earning', [lots])).map((r) => r.order_id);
  const rows = orders.flatMap((o, i) => [
    { line_hash: `po-${i}-c`, order_id: o, product_id: 'x', transaction_type: 'Charge', amount_micro: 9990000 },
    { line_hash: `po-${i}-f`, order_id: o, product_id: 'x', transaction_type: 'Google fee', amount_micro: -1500000 },
  ]);
  const batch = (await one(`select play_settlement_import('2026-11', 'po.csv', $1::jsonb, $2) as r`, [JSON.stringify(rows), ADMIN])).r.batch_id;
  await one(`select play_settlement_mark_funds($1, $2, 'BANK-2')`, [batch, ADMIN]);
  const creator = payee;
  const request = (amount, key, party = creator) => one(`select payout_request_create('participant', $1, 'gift_recipient', $2, $3) as r`, [party, amount, key]);
  await fails(request(5000000, 'po-00000001'), /payouts_disabled/);
  await setting('payouts_enabled = true, min_payout_micro = 100000');
  await fails(request(100000, 'po-00000001'), /payee_profile_required/);
  await db.query(`insert into payee_profiles (party_type, party_id, legal_name, country, date_of_birth, payout_method)
                  values ('participant', $1, 'Creator Person', 'NG', current_date - interval '17 years', 'bank_transfer')`, [creator]);
  await fails(request(100000, 'po-00000001'), /payee_not_verified/);
  await db.query(`update payee_profiles set kyc_status = 'verified' where party_id = $1`, [creator]);
  await fails(request(100000, 'po-00000001'), /payee_under_18/);
  await db.query(`update payee_profiles set date_of_birth = current_date - interval '30 years' where party_id = $1`, [creator]);
  await fails(request(50000, 'po-00000001'), /below_minimum/);

  const avail = (await bal('participant', creator, 'gift_recipient')).available;
  assert.ok(avail >= 100000, `available ${avail}`);
  await fails(request(avail + 1, 'po-00000002'), /insufficient_available_balance/);
  const first = (await request(100000, 'po-00000003')).r;
  const replay = (await request(100000, 'po-00000003')).r;
  assert.equal(replay.already_requested, true);
  const mid = await bal('participant', creator, 'gift_recipient');
  assert.equal(mid.available, avail - 100000);
  assert.equal(mid.reserved, 100000);
  // A second request can't spend reserved money.
  await fails(request(mid.available + 1, 'po-00000004'), /insufficient_available_balance/);

  await fails(one(`select payout_request_decide($1, 'mark_paid', $2, null, null)`, [first.request_id, ADMIN]), /invalid_transition/);
  await one(`select payout_request_decide($1, 'approve', $2, null, null)`, [first.request_id, ADMIN]);
  await fails(one(`select payout_request_decide($1, 'mark_paid', $2, '', null)`, [first.request_id, ADMIN]), /reference_required/);
  await one(`select payout_request_decide($1, 'mark_failed', $2, null, 'bank rejected')`, [first.request_id, ADMIN]);
  assert.equal((await bal('participant', creator, 'gift_recipient')).available, avail, 'failed payout returns the money');

  const second = (await request(100000, 'po-00000005')).r;
  await one(`select payout_request_decide($1, 'approve', $2, null, null)`, [second.request_id, ADMIN]);
  await one(`select payout_request_decide($1, 'mark_paid', $2, 'TRF-123', null)`, [second.request_id, ADMIN]);
  const end = await bal('participant', creator, 'gift_recipient');
  assert.equal(end.paid, 100000);
  assert.equal(end.reserved, 0);
  assert.ok((await all('select * from payout_events where request_id = $1', [second.request_id])).length >= 3);
});

// ---------------------------------------------------------------------------
// Affiliate marketplace
// ---------------------------------------------------------------------------
const ITEM = id(500);
const ITEM2 = id(501);
let partnerId;
let offerId;
let membershipId;
let linkCode = 'LINKCODE1';

test('offers and joining follow the seller\'s rules', async () => {
  await db.query(`insert into catalogue_items (id, seller_username, title, price_usd) values ($1, 'seller', 'Sneakers', 40), ($2, 'seller', 'Bag', 35)`, [ITEM, ITEM2]);
  partnerId = (await one(`insert into affiliate_partners (participant_id, handle, display_name) values ($1, 'dreamstyle', 'DreamStyle') returning id`, [partnerP])).id;
  const sellerPartner = (await one(`insert into affiliate_partners (participant_id, handle, display_name) values ($1, 'sellerself', 'Seller Self') returning id`, [seller])).id;
  offerId = (await one(`insert into affiliate_offers (item_id, seller_username, funding, commission_percent, allow_resale, resale_floor_usd, resale_ceiling_usd)
    values ($1, 'seller', 'platform', 10, true, 40, 70) returning id`, [ITEM])).id;
  await fails(one(`select affiliate_join_offer($1, $2, 'referral', null)`, [sellerPartner, offerId]), /own_listing/);
  await fails(one(`select affiliate_join_offer($1, $2, 'resale', 30)`, [partnerId, offerId]), /resale_price_out_of_range/);
  await fails(one(`select affiliate_join_offer($1, $2, 'resale', 80)`, [partnerId, offerId]), /resale_price_out_of_range/);
  const sellerFunded = (await one(`insert into affiliate_offers (item_id, seller_username, funding, commission_percent) values ($1, 'seller', 'seller', 10) returning id`, [ITEM2])).id;
  await fails(one(`select affiliate_join_offer($1, $2, 'referral', null)`, [partnerId, sellerFunded]), /offer_not_accepted_by_seller/);
  await db.query(`update affiliate_offers set seller_accepted_terms_version = terms_version, seller_accepted_at = now() where id = $1`, [sellerFunded]);
  const joined2 = (await one(`select affiliate_join_offer($1, $2, 'referral', null) as r`, [partnerId, sellerFunded])).r;
  assert.equal(joined2.status, 'approved');
  const joined = (await one(`select affiliate_join_offer($1, $2, 'referral', null) as r`, [partnerId, offerId])).r;
  membershipId = joined.membership_id;
  await db.query(`insert into affiliate_links (code, partner_id, target, membership_id) values ($1, $2, 'membership', $3), ('STORE0001', $2, 'storefront', null)`, [linkCode, partnerId, membershipId]);
});

const click = (code, item) => one(`select affiliate_record_click($1, $2, 'visitor-hash') as r`, [code, item]).then((r) => r.r);
const intent = (ref, method, email, clicks) => one(`select affiliate_record_intent($1, $2, $3, $4::uuid[]) as r`, [ref, method, email ? emailHash(email) : null, clicks]).then((r) => r.r);
async function order({ item = ITEM, amount = 40, commission = 2, buyerEmail = 'shopper@example.com', ref, checkoutRef, createdAt = 'now()', status = 'paid' }) {
  let checkoutId = null;
  if (checkoutRef) checkoutId = (await one(`insert into catalogue_checkouts (payment_ref, buyer_email) values ($1, $2) returning id`, [checkoutRef, buyerEmail])).id;
  return (await one(`insert into catalogue_orders (item_id, seller_username, buyer_email, amount_usd, commission_usd, status, payment_ref, checkout_id, created_at)
    values ($1, 'seller', $2, $3, $4, $5, $6, $7, ${createdAt}) returning id`, [item, buyerEmail, amount, commission, status, checkoutRef ? null : ref, checkoutId])).id;
}

test('platform-funded attribution: intent before payment, matched later on the server, capped by the platform commission and budget', async () => {
  await setting('platform_monthly_budget_micro = 10000000');
  const c = await click(linkCode, ITEM);
  await intent('CART_1', 'paystack', null, [c.click_id]);
  assert.equal((await intent('CART_1', 'paystack', null, [c.click_id])).already_recorded, true, 'one intent per reference');
  // The buyer closed the app after paying: the order is created later, the match still happens.
  const orderId = await order({ checkoutRef: 'CART_1' });
  const res = (await one(`select affiliate_match_intents() as r`)).r;
  assert.equal(res.intents_matched, 1);
  const at = await one('select * from affiliate_attributions where order_id = $1', [orderId]);
  // 10% of $40 = $4, capped at 50% of One Dream's $2 commission = $1.
  assert.equal(at.status, 'pending');
  assert.equal(Number(at.commission_micro), 1000000);
  assert.equal((await bal('participant', partnerP, 'affiliate')).pending, 1000000);
  // Matching again changes nothing.
  await one(`select affiliate_match_intents()`);
  assert.equal(await one('select count(*)::int n from affiliate_attributions').then((r) => r.n), 1);
});

test('released with the order, held while disputed, reversible by admin', async () => {
  const c = await click(linkCode, ITEM);
  await intent('ITEM_2', 'paystack', null, [c.click_id]);
  const orderId = await order({ ref: 'ITEM_2' });
  await one(`select affiliate_match_intents()`);
  await db.query(`update catalogue_orders set status = 'disputed' where id = $1`, [orderId]);
  await one(`select affiliate_advance()`);
  assert.equal((await one('select status from affiliate_attributions where order_id = $1', [orderId])).status, 'held');
  // Dispute resolved by the existing order flow (order confirmed): released automatically.
  await db.query(`update catalogue_orders set status = 'buyer_confirmed' where id = $1`, [orderId]);
  const before = await bal('participant', partnerP, 'affiliate');
  await one(`select affiliate_advance()`);
  const at = await one('select * from affiliate_attributions where order_id = $1', [orderId]);
  assert.equal(at.status, 'available');
  const after = await bal('participant', partnerP, 'affiliate');
  assert.equal(after.available - before.available, Number(at.commission_micro));
  assert.equal(before.pending - after.pending, Number(at.commission_micro));
  await one(`select affiliate_reverse_attribution($1, $2, 'refunded')`, [at.id, ADMIN]);
  assert.equal((await bal('participant', partnerP, 'affiliate')).available, after.available - Number(at.commission_micro));

  // Dispute settled by an admin without changing the order: released explicitly.
  const c2 = await click(linkCode, ITEM);
  await intent('ITEM_3', 'paystack', null, [c2.click_id]);
  const order2 = await order({ ref: 'ITEM_3', status: 'disputed' });
  await one(`select affiliate_match_intents()`);
  await one(`select affiliate_advance()`);
  const held = await one('select * from affiliate_attributions where order_id = $1', [order2]);
  assert.equal(held.status, 'held');
  await one(`select affiliate_release_held($1, $2, 'dispute resolved for seller')`, [held.id, ADMIN]);
  assert.equal((await one('select status from affiliate_attributions where id = $1', [held.id])).status, 'available');
});

test('USDT: the tx hash is public, so the intent must carry the buyer\'s checkout email', async () => {
  const c = await click(linkCode, ITEM);
  await intent('0xhash-wrong', 'usdt', 'attacker@example.com', [c.click_id]);
  const wrong = await order({ ref: '0xhash-wrong', buyerEmail: 'real@example.com' });
  const c2 = await click(linkCode, ITEM);
  await intent('0xhash-right', 'usdt', 'Real@Example.com', [c2.click_id]);
  const right = await order({ ref: '0xhash-right', buyerEmail: 'real@example.com' });
  await one(`select affiliate_match_intents()`);
  assert.equal(await one('select count(*)::int n from affiliate_attributions where order_id = $1', [wrong]).then((r) => r.n), 0);
  assert.equal(await one('select count(*)::int n from affiliate_attributions where order_id = $1', [right]).then((r) => r.n), 1);
});

test('clicks after the order or outside the 7-day window never count; the partner can\'t buy for commission', async () => {
  const old = await click(linkCode, ITEM);
  await db.query(`update affiliate_clicks set created_at = now() - interval '8 days' where id = $1`, [old.click_id]);
  await intent('ITEM_OLD', 'paystack', null, [old.click_id]);
  const o1 = await order({ ref: 'ITEM_OLD' });
  const self = await click(linkCode, ITEM);
  await intent('ITEM_SELF', 'paystack', null, [self.click_id]);
  const o2 = await order({ ref: 'ITEM_SELF', buyerEmail: 'partner@example.com' });
  await one(`select affiliate_match_intents()`);
  assert.equal(await one('select count(*)::int n from affiliate_attributions where order_id = $1', [o1]).then((r) => r.n), 0);
  assert.equal((await one('select status, status_reason from affiliate_attributions where order_id = $1', [o2])).status_reason, 'partner_is_buyer');
});

test('seller-funded commission is recorded but only accrues once P1 is applied', async () => {
  const lk = (await one(`insert into affiliate_links (code, partner_id, target, membership_id)
    select 'SELLERF01', $1, 'membership', m.id from affiliate_memberships m join affiliate_offers o on o.id = m.offer_id
     where o.item_id = $2 and m.partner_id = $1 returning code`, [partnerId, ITEM2])).code;
  const c = await click(lk, ITEM2);
  await intent('ITEM_SF', 'paystack', null, [c.click_id]);
  const o = await order({ item: ITEM2, ref: 'ITEM_SF', amount: 35, commission: 1.75 });
  await one(`select affiliate_match_intents()`);
  const at = await one('select * from affiliate_attributions where order_id = $1', [o]);
  assert.equal(at.status, 'awaiting_seller_settlement');
  assert.equal(Number(at.commission_micro), 3500000, '10% of $35, shown to the partner as not yet payable');
  assert.equal(await one(`select count(*)::int n from partner_ledger where ref_id = $1`, [at.id]).then((r) => r.n), 0);
  // With P1 applied, the same offer accrues.
  await setting('seller_funded_settlement_enabled = true');
  const c2 = await click(lk, ITEM2);
  await intent('ITEM_SF2', 'paystack', null, [c2.click_id]);
  const o2 = await order({ item: ITEM2, ref: 'ITEM_SF2', amount: 35, commission: 1.75 });
  await one(`select affiliate_match_intents()`);
  assert.equal((await one('select status from affiliate_attributions where order_id = $1', [o2])).status, 'pending');
  await setting('seller_funded_settlement_enabled = false');
});

test('the monthly platform budget is never exceeded', async () => {
  await setting('platform_monthly_budget_micro = 1');
  const c = await click(linkCode, ITEM);
  await intent('ITEM_BUDGET', 'paystack', null, [c.click_id]);
  const o = await order({ ref: 'ITEM_BUDGET' });
  await one(`select affiliate_match_intents()`);
  const at = await one('select * from affiliate_attributions where order_id = $1', [o]);
  assert.equal(at.status, 'over_budget');
  assert.equal(Number(at.commission_micro), 0);
  await setting('platform_monthly_budget_micro = 100000000');
});

test('resale: falls back to referral at the seller price until P3; with P3 the margin is earned', async () => {
  const resellerP = id(8);
  await db.query(`insert into participants (id, username, email) values ($1, 'reseller', 'reseller@example.com')`, [resellerP]);
  const rp = (await one(`insert into affiliate_partners (participant_id, handle, display_name) values ($1, 'resell', 'Resell') returning id`, [resellerP])).id;
  const m = (await one(`select affiliate_join_offer($1, $2, 'resale', 55) as r`, [rp, offerId])).r;
  await fails(one(`select affiliate_set_resale_price($1, $2, 39)`, [rp, m.membership_id]), /resale_price_out_of_range/);
  await db.query(`insert into affiliate_links (code, partner_id, target, membership_id) values ('RESALE001', $1, 'membership', $2)`, [rp, m.membership_id]);
  const c = await click('RESALE001', ITEM);
  await intent('ITEM_RS', 'paystack', null, [c.click_id]);
  const o = await order({ ref: 'ITEM_RS' });
  await one(`select affiliate_match_intents()`);
  const at = await one('select * from affiliate_attributions where order_id = $1', [o]);
  assert.equal(at.model, 'referral');
  assert.equal(at.source, 'affiliate');

  // P3 simulated: the order carries the reseller price, floor and the platform fee on the margin.
  await db.exec(`alter table catalogue_orders add column resale_membership_id uuid, add column resale_price_usd numeric,
                 add column resale_floor_usd numeric, add column resale_platform_fee_usd numeric`);
  await setting('resale_checkout_enabled = true');
  const split = resaleSplit({ resalePriceUsd: 55, floorUsd: 40, platformPercent: 5 });
  const c2 = await click('RESALE001', ITEM);
  await intent('ITEM_RS2', 'paystack', null, [c2.click_id]);
  const o2 = (await one(`insert into catalogue_orders (item_id, seller_username, buyer_email, amount_usd, commission_usd, status, payment_ref,
      resale_membership_id, resale_price_usd, resale_floor_usd, resale_platform_fee_usd)
    values ($1, 'seller', 'b@example.com', 55, 2.75, 'paid', 'ITEM_RS2', $2, 55, 40, 0.75) returning id`, [ITEM, m.membership_id])).id;
  await one(`select affiliate_match_intents()`);
  const at2 = await one('select * from affiliate_attributions where order_id = $1', [o2]);
  assert.equal(at2.source, 'resale');
  assert.equal(Number(at2.commission_micro), split.reseller_receives_micro);
  assert.equal((await bal('participant', resellerP, 'resale')).pending, split.reseller_receives_micro);
  await setting('resale_checkout_enabled = false');
});

test('seller referral reward: platform-funded, time-limited, never twice on one order; buyer referral once', async () => {
  await setting('seller_referral_percent = 20, buyer_referral_reward_micro = 250000');
  const o = await order({ ref: 'ITEM_REF1', status: 'buyer_confirmed' });
  await one(`select affiliate_advance()`);
  const rr = await one(`select * from referral_rewards where order_id = $1`, [o]);
  assert.equal(rr.merchant_id, MERCHANT);
  assert.equal(Number(rr.amount_micro), 400000, '20% of the $2 platform commission');
  assert.equal((await bal('merchant', MERCHANT, 'referral')).available >= 400000, true);
  await one(`select affiliate_advance()`);
  assert.equal(await one('select count(*)::int n from referral_rewards where order_id = $1', [o]).then((r) => r.n), 1);

  // Buyer referral: a referred participant's first confirmed purchase, once.
  const o1 = await order({ ref: 'ITEM_BUY1', buyerEmail: 'creator@example.com', status: 'buyer_confirmed' });
  const o2 = await order({ ref: 'ITEM_BUY2', buyerEmail: 'creator@example.com', status: 'buyer_confirmed' });
  await one(`select affiliate_advance()`);
  const buyerRewards = await all(`select * from referral_rewards where kind = 'buyer'`);
  assert.equal(buyerRewards.length, 1);
  assert.ok([o1, o2].includes(buyerRewards[0].order_id));

  // Seller referred longer ago than the window: no reward.
  await db.query(`update participants set created_at = now() - interval '7 months' where id = $1`, [seller]);
  const late = await order({ ref: 'ITEM_LATE', status: 'buyer_confirmed', buyerEmail: 'z@example.com' });
  await one(`select affiliate_advance()`);
  assert.equal(await one(`select count(*)::int n from referral_rewards where order_id = $1 and kind = 'seller'`, [late]).then((r) => r.n), 0);
});

// ---------------------------------------------------------------------------
// JS rules
// ---------------------------------------------------------------------------
test('rules: attribution tokens, offers, splits, report parsing', () => {
  const secret = 'test-secret';
  const token = signAttributionToken({ clickId: id(1), itemId: id(2), issuedAt: 1000 }, secret);
  assert.deepEqual(verifyAttributionToken(token, secret, 0, 2000), { clickId: id(1), itemId: id(2), issuedAt: 1000 });
  assert.equal(verifyAttributionToken(token, 'other', 0), null);
  assert.equal(verifyAttributionToken(token.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')), secret, 0), null);
  assert.equal(verifyAttributionToken(token, secret, 500, 2000), null, 'expired');

  assert.equal(validateOffer({ commission_percent: 31 }, { maxCommissionPercent: 30 }).ok, false);
  assert.equal(validateOffer({ allow_resale: true }, { maxCommissionPercent: 30 }).ok, false);
  assert.equal(validateOffer({ fulfilment: 'reseller', allow_resale: true, resale_floor_usd: 40, reseller_responsibilities: { delivery: 'reseller' } }, { maxCommissionPercent: 30 }).ok, false);
  assert.equal(validateOffer({ commission_percent: 10 }, { maxCommissionPercent: 30 }).ok, true);
  assert.deepEqual(sellerFundedImpact(40, 10, 5), { gross_micro: 40000000, platform_micro: 2000000, commission_micro: 4000000, seller_receives_micro: 34000000 });
  assert.deepEqual(resaleSplit({ resalePriceUsd: 55, floorUsd: 40, platformPercent: 5 }),
    { buyer_pays_micro: 55000000, seller_receives_micro: 38000000, reseller_receives_micro: 14250000, platform_micro: 2750000,
      seller_fee_micro: 2000000, margin_fee_micro: 750000 });
  const odd = resaleSplit({ resalePriceUsd: 14.99, floorUsd: 9.99, quantity: 3, platformPercent: 5 });
  assert.equal(odd.seller_receives_micro + odd.reseller_receives_micro + odd.platform_micro, odd.buyer_pays_micro, 'cent-exact split');
  assert.equal(odd.platform_micro % 10000, 0);
  assert.throws(() => resaleSplit({ resalePriceUsd: 39, floorUsd: 40, platformPercent: 5 }));
  const s = giftSplit(5300000, 50, 10);
  assert.equal(s.recipient_micro + s.merchant_micro + s.platform_micro, 5300000);

  const ngnReport = parsePlayEarningsReport('Description,Transaction Type,Merchant Currency,Amount (Merchant Currency)\nGPA.1,Charge,NGN,100');
  assert.equal(ngnReport.rows.length, 0);
  assert.match(ngnReport.errors[0], /only USD/);
  assert.match(parsePlayEarningsReport('a,b\n1,2').errors[0], /Missing column/);
});

// ---------------------------------------------------------------------------
// Protected patch P1 (prepared, not applied in production): proven here on the
// in-memory copy only.
// ---------------------------------------------------------------------------
test('P1 patch: seller-funded commission comes off the seller wallet; earlier unpaid ones never do', async () => {
  const fs = await import('node:fs/promises');
  await db.exec(`
    alter table catalogue_orders add column if not exists commission_percent numeric;
    create table if not exists participant_withdrawals (username text, amount_usd numeric, status text, source text);
    update catalogue_orders set commission_percent = 5, seller_net_usd = amount_usd - commission_usd;
    update catalogue_orders set status = 'buyer_confirmed' where payment_ref in ('ITEM_SF', 'ITEM_SF2');
  `);
  await db.exec(await fs.readFile(new URL('../docs/protected-patches/P1_seller_funded_commission.sql', import.meta.url), 'utf8'));
  const accrued = Number((await one(`select coalesce(sum(commission_micro), 0)::bigint s from affiliate_attributions a
    join catalogue_orders o on o.id = a.order_id where a.funding = 'seller' and a.source = 'affiliate' and a.status in ('pending', 'held', 'available')
    and o.seller_username = 'seller' and o.status in ('buyer_confirmed', 'released')`)).s);
  assert.equal(accrued, 3500000, 'the $3.50 seller-funded commission accrued after P1');
  const gross = Number((await one(`select coalesce(sum(seller_net_usd), 0) s from catalogue_orders where seller_username = 'seller' and status in ('buyer_confirmed', 'released')`)).s);
  const summary = await one(`select * from seller_earnings_summary('seller')`);
  assert.equal(Math.round(Number(summary.withdrawable_earned_usd) * 100), Math.round(gross * 100 - accrued / 10000));
  // The pre-P1 seller-funded attribution ('awaiting_seller_settlement') is never deducted.
  const awaiting = await one(`select count(*)::int n from affiliate_attributions where status = 'awaiting_seller_settlement'`);
  assert.ok(awaiting.n >= 1);
});

test('rollback: refuses once money is recorded; on a clean database it removes only the new objects', async () => {
  const fs = await import('node:fs/promises');
  const rollback = await fs.readFile(new URL('../supabase/rollback_earnings_affiliate.sql', import.meta.url), 'utf8');
  await fails(db.exec(rollback), /Earnings ledger has records/);

  const fresh = await earningsTestDb();
  try {
    await fresh.db.exec(rollback);
    assert.equal((await fresh.db.query(`select to_regclass('public.partner_ledger') as t`)).rows[0].t, null);
    await fresh.db.exec(await fs.readFile(new URL('../supabase/add_dream_coins_gifting.sql', import.meta.url), 'utf8'));
    await fresh.db.exec(`insert into participants (id, username, email) values ('${id(77)}', 'rb', 'rb@example.com')`);
    const r = (await fresh.db.query(`select dream_coins_credit_purchase($1, 'dream_coins_100', 'dream_coins_100', 'rb-tok', null, 1, false, now()) as r`, [id(77)])).rows[0].r;
    assert.equal(r.total_coins, 100, 'Dream Coins keep working with the original functions');
  } finally {
    await fresh.db.close();
  }
});
