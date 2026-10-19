// Multi-currency listings: exact money maths, checkout quotes, and the real
// migration SQL in an in-memory Postgres (PGlite). No network, no payments.
//   node --test scripts/test-multicurrency.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsTestDb } from './lib/earnings-test-db.mjs';
import {
  buildQuote, convertToUsdCents, convertUsdCentsTo, displayEquivalent, minorToDecimal, parseRate, percentOf,
  rateJumpTooLarge, rateProblem, toMinor, usdMicroEquivalent, validateListingPrice,
} from '../lib/currencyRules.js';
import {
  applyQuoteToOrders, paymentMatchesQuote, publicQuote, quoteCheckoutRecord, quoteOrderFields, quotePaystackMetadata, sameLines, snapshotRow,
} from '../lib/quoteRules.js';

const C = (code, settlement, route, minor = 2) => [code, { code, minor_units: minor, settlement_currency: settlement, checkout_route: route, is_enabled: true, symbol: code }];
const currencies = new Map([C('NGN', 'NGN', 'paystack'), C('USD', 'USD', 'usdt'), C('GBP', 'USD', 'usdt'), C('EUR', 'USD', 'usdt'), C('GHS', 'USD', 'usdt'), C('JPY', 'USD', 'usdt', 0)]);
const now = new Date().toISOString();
const rates = new Map([
  ['NGN', { rate: '1600', source: 'test', source_published_at: now, id: 1 }],
  ['GBP', { rate: '0.769230769231', source: 'test', source_published_at: now, id: 2 }],   // 1 USD = 0.7692 GBP -> £1 = $1.30
  ['GHS', { rate: '15.5', source: 'test', source_published_at: now, id: 3 }],
  ['JPY', { rate: '150', source: 'test', source_published_at: now, id: 4 }],
]);
const policy = { commission_percent: 5, buyer_fee_percent: 1, buyer_fee_cap_usd_cents: 100 };

test('minor units are exact: no floating point anywhere', () => {
  assert.equal(toMinor('18000', 2), 1800000n);
  assert.equal(toMinor('0.1', 2), 10n);
  assert.equal(toMinor('19.999', 2), null, 'more decimals than the currency has');
  assert.equal(toMinor('1500', 0), 1500n);
  assert.equal(minorToDecimal(1800000n, 2), '18000.00');
  assert.equal(minorToDecimal(5n, 2), '0.05');
  assert.equal(parseRate('0.769230769231'), 769230769231n);
  assert.equal(percentOf(13000n, 5), 650n);
  assert.equal(percentOf(3n, 5), 0n, '5% of 3 kobo rounds half-up to 0');
  assert.equal(percentOf(10n, 5), 1n, '5% of 10 = 0.5 -> 1');
});

test('the owner\'s example: £100 at 1.30 -> 130.00 USDT, 6.50 commission, 123.50 to the seller', () => {
  assert.equal(convertToUsdCents(10000n, 2, '0.769230769231'), 13000n);
  const q = buildQuote({
    lines: [{ item_id: 'gbp-item', quantity: 1, listing_currency: 'GBP', listing_unit_minor: '10000' }],
    currencies, rates, policy: { ...policy, buyer_fee_percent: 0 },
  });
  assert.equal(q.checkout_currency, 'USD');
  assert.equal(q.checkout_route, 'usdt');
  const [line] = q.lines;
  assert.equal(line.listing_line_minor, '10000', 'the seller\'s £100.00 is kept');
  assert.equal(line.charged_minor, '13000');
  assert.equal(line.commission_minor, '650');
  assert.equal(line.seller_earnings_minor, '12350');
  assert.equal(line.rate_per_usd, '0.769230769231');
  assert.equal(q.total_minor, '13000');
});

test('NGN listings are charged exactly in naira, with no conversion, and settle in naira', () => {
  const q = buildQuote({
    lines: [{ item_id: 'ngn-item', quantity: 2, listing_currency: 'NGN', listing_unit_minor: '1800000' }],
    currencies, rates, policy,
  });
  assert.equal(q.checkout_currency, 'NGN');
  assert.equal(q.checkout_route, 'paystack');
  assert.equal(q.lines[0].charged_minor, '3600000', '2 x ₦18,000 = ₦36,000 exactly');
  assert.equal(q.lines[0].rate_per_usd, null);
  assert.equal(q.lines[0].settlement_currency, 'NGN');
  // 1% fee of ₦36,000 = ₦360, below the $1 cap (₦1,600 at 1600/USD).
  assert.equal(q.service_fee_minor, '36000');
  const big = buildQuote({ lines: [{ item_id: 'x', quantity: 1, listing_currency: 'NGN', listing_unit_minor: '50000000' }], currencies, rates, policy });
  assert.equal(big.service_fee_minor, '160000', 'fee capped at $1 = ₦1,600');
  assert.equal(big.lines[0].usd_equivalent_micro, String(500000n * 1000000n / 1600n), 'USD equivalent for reporting only');
});

test('USD-route carts combine USD, GBP and GHS lines at their own recorded rates', () => {
  const q = buildQuote({
    lines: [
      { item_id: 'usd', quantity: 1, listing_currency: 'USD', listing_unit_minor: '2000' },
      { item_id: 'gbp', quantity: 3, listing_currency: 'GBP', listing_unit_minor: '999' },
      { item_id: 'ghs', quantity: 1, listing_currency: 'GHS', listing_unit_minor: '15500' },
    ],
    currencies, rates, policy,
  });
  assert.deepEqual(q.lines.map((l) => l.charged_minor), ['2000', '3896', '1000']);
  assert.equal(q.subtotal_minor, '6896');
  assert.equal(BigInt(q.total_minor), BigInt(q.subtotal_minor) + BigInt(q.service_fee_minor));
  for (const l of q.lines) assert.equal(BigInt(l.commission_minor) + BigInt(l.seller_earnings_minor), BigInt(l.charged_minor));
  assert.deepEqual(Object.keys(q.rates).sort(), ['GBP', 'GHS']);
});

test('zero-decimal currencies convert correctly', () => {
  assert.equal(convertToUsdCents(1500n, 0, '150'), 1000n, '¥1,500 at 150/USD = $10.00');
  assert.equal(validateListingPrice({ currency: 'JPY', amount: '1500.5' }, currencies).ok, false);
});

test('a cart mixing naira and other currencies is refused, with the groups to pay separately', () => {
  assert.throws(() => buildQuote({
    lines: [
      { item_id: 'ngn', quantity: 1, listing_currency: 'NGN', listing_unit_minor: '100000' },
      { item_id: 'gbp', quantity: 1, listing_currency: 'GBP', listing_unit_minor: '1000' },
    ], currencies, rates, policy,
  }), (e) => e.message === 'mixed_checkout_currencies' && e.groups.length === 2);
});

test('stale, invalid and jumping rates are refused; a missing rate never falls back', () => {
  assert.equal(rateProblem(null, 3600), 'rate_unavailable');
  assert.equal(rateProblem({ rate: '0', source_published_at: now }, 3600), 'rate_invalid');
  assert.equal(rateProblem({ rate: '1600', source_published_at: new Date(Date.now() - 7200e3).toISOString() }, 3600), 'rate_stale');
  assert.equal(rateProblem({ rate: '1600', source_published_at: now }, 3600), null);
  assert.equal(rateJumpTooLarge('1600', '1900', 15), true);
  assert.equal(rateJumpTooLarge('1600', '1700', 15), false);
  assert.throws(() => buildQuote({ lines: [{ item_id: 'eur', quantity: 1, listing_currency: 'EUR', listing_unit_minor: '1000' }], currencies, rates, policy }), /rate_unavailable:EUR/);
});

test('display equivalents are approximate and never used for charging', () => {
  assert.equal(displayEquivalent(10000n, currencies.get('GBP'), currencies.get('USD'), rates), 13000n);
  assert.equal(displayEquivalent(1800000n, currencies.get('NGN'), currencies.get('USD'), rates), 1125n);
  assert.equal(displayEquivalent(1000n, currencies.get('USD'), currencies.get('USD'), rates), null);
  assert.equal(convertUsdCentsTo(100n, 2, '1600'), 160000n);
  assert.equal(usdMicroEquivalent(1000n, 2, null), 10000000n);
});

// ---------------------------------------------------------------------------
// Checkout from a stored quote (lib/quoteRules.js, used by protected patch P7)
// ---------------------------------------------------------------------------
const stored = (body) => ({ ...body, id: '11111111-2222-4333-8444-555555555555', expires_at: new Date(Date.now() + 60e3).toISOString() });

test('P7 helpers: a naira quote becomes exact naira orders with USD equivalents for reports only', () => {
  const q = stored(buildQuote({
    lines: [{ item_id: 'a', quantity: 2, listing_currency: 'NGN', listing_unit_minor: '900000' }, { item_id: 'b', quantity: 1, listing_currency: 'NGN', listing_unit_minor: '50050' }],
    currencies, rates, policy,
  }));
  assert.equal(q.total_minor, String(1800000n + 50050n + 18501n), '1% fee on ₦18,500.50 is ₦185.01 (cap ₦1,600 not reached)');
  const fields = quoteOrderFields(q, q.lines[0]);
  assert.deepEqual(fields, { amount_usd: 11.25, unit_price_usd: 5.63, commission_percent: 5, commission_usd: 0.56, seller_net_usd: 10.69, currency: 'NGN', amount_ngn: 18000 });
  const record = quoteCheckoutRecord(q);
  assert.equal(Math.round(record.total_usd * 100), Math.round(record.subtotal_usd * 100) + Math.round(record.service_fee_usd * 100), 'total = subtotal + fee, cent-exact');
  assert.equal(record.amount_ngn, Number(q.total_minor) / 100);
  assert.equal(record.exchange_rate, 1600);
  const meta = quotePaystackMetadata(q);
  assert.equal(meta.quote_id, q.id);
  assert.equal(meta.type, 'catalogue_cart');
  const rows = applyQuoteToOrders([{ item_id: 'b', seller_username: 's', amount_usd: 999, exchange_rate: 1 }], q);
  assert.equal(rows[0].amount_ngn, 500.5);
  assert.equal(rows[0].exchange_rate, 1600);
  assert.equal(rows[0].seller_username, 's', 'other order fields are kept');
  const snap = snapshotRow('order-1', q, q.lines[1]);
  assert.equal(BigInt(snap.commission_minor) + BigInt(snap.seller_earnings_minor), BigInt(snap.charged_minor));
  assert.equal(snap.settlement_currency, 'NGN');
  assert.equal(publicQuote(q).lines[0].seller_earnings_minor, undefined, 'buyers never see seller earnings');
});

test('P7 helpers: Paystack must match the naira total exactly; USDT must cover the dollar total', () => {
  const ngnQ = stored(buildQuote({ lines: [{ item_id: 'a', quantity: 1, listing_currency: 'NGN', listing_unit_minor: '1800000' }], currencies, rates, policy }));
  assert.equal(paymentMatchesQuote(ngnQ, { paystackKobo: Number(ngnQ.total_minor) }), true);
  assert.equal(paymentMatchesQuote(ngnQ, { paystackKobo: Number(ngnQ.total_minor) - 1 }), false, 'one kobo short is refused');
  assert.equal(paymentMatchesQuote(ngnQ, { paystackKobo: Number(ngnQ.total_minor) + 100 }), false, 'overpaying is refused too (exact)');
  const usdQ = stored(buildQuote({ lines: [{ item_id: 'g', quantity: 1, listing_currency: 'GBP', listing_unit_minor: '10000' }], currencies, rates, policy: { ...policy, buyer_fee_percent: 0 } }));
  assert.equal(usdQ.total_minor, '13000');
  assert.equal(paymentMatchesQuote(usdQ, { usdtAmount: 130 }), true);
  assert.equal(paymentMatchesQuote(usdQ, { usdtAmount: 129.99 }), true, 'same 1 cent tolerance as the existing cart check');
  assert.equal(paymentMatchesQuote(usdQ, { usdtAmount: 129.98 }), false);
  const f = quoteOrderFields(usdQ, usdQ.lines[0]);
  assert.deepEqual([f.amount_usd, f.commission_usd, f.seller_net_usd, f.currency, f.amount_ngn], [130, 6.5, 123.5, 'USD', null]);
  assert.equal(quoteCheckoutRecord(usdQ).exchange_rate, undefined, 'a USD checkout keeps the existing exchange_rate value');
  assert.equal(sameLines([{ item_id: 'a', quantity: 2 }, { item_id: 'b', quantity: 1 }], [{ item_id: 'b', quantity: 1 }, { item_id: 'a', quantity: 2 }]), true);
  assert.equal(sameLines([{ item_id: 'a', quantity: 2 }], [{ item_id: 'a', quantity: 3 }]), false);
});

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const { db, verification } = await earningsTestDb();
test.after(() => db.close());
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('migration applies on top of the existing exchange_rates table and verifies', async () => {
  assert.deepEqual(verification['add_multicurrency_listings.sql'].filter((r) => !r.ok), []);
  assert.deepEqual(verification['fix_multicurrency_review.sql'].filter((r) => !r.ok), [], 'review fixes verify');
  // The existing Paystack conversion table is untouched.
  assert.equal(Number((await one(`select rate from exchange_rates where target = 'NGN'`)).rate), 1600);
  assert.equal((await one(`select count(*)::int n from marketplace_currencies`)).n, 5);
});

test('USD listings keep their minor-unit price in step with price_usd edits', async () => {
  await db.query(`insert into catalogue_items (id, seller_username, title, price_usd) values ($1, 'seller', 'Lamp', 12.5)`, [id(1)]);
  assert.equal(Number((await one('select listing_price_minor from catalogue_items where id = $1', [id(1)])).listing_price_minor), 1250);
  await db.query(`update catalogue_items set price_usd = 20 where id = $1`, [id(1)]);
  assert.equal(Number((await one('select listing_price_minor from catalogue_items where id = $1', [id(1)])).listing_price_minor), 2000);
  // An NGN listing's exact price is not overwritten by a price_usd edit.
  await db.query(`update catalogue_items set listing_currency = 'NGN', listing_price_minor = 1800000 where id = $1`, [id(1)]);
  await db.query(`update catalogue_items set price_usd = 11.25 where id = $1`, [id(1)]);
  assert.equal(Number((await one('select listing_price_minor from catalogue_items where id = $1', [id(1)])).listing_price_minor), 1800000);
});

test('frozen order snapshots: settlement-currency money, earnings per currency, append-only', async () => {
  await db.exec(`
    insert into participants (id, username, email) values ('${id(10)}', 'ngnseller', 'n@example.com'), ('${id(11)}', 'partner', 'p@example.com');
    insert into catalogue_items (id, seller_username, title, price_usd, listing_currency, listing_price_minor) values ('${id(20)}', 'ngnseller', 'Ankara', 11.25, 'NGN', 1800000);
    insert into catalogue_orders (id, item_id, seller_username, buyer_email, amount_usd, commission_usd, status, payment_ref)
      values ('${id(30)}', '${id(20)}', 'ngnseller', 'buyer@example.com', 11.25, 0.56, 'buyer_confirmed', 'ITEM_NGN1'),
             ('${id(31)}', '${id(20)}', 'ngnseller', 'buyer@example.com', 20, 1, 'paid', 'ITEM_USD1');
    insert into catalogue_checkouts (id, payment_ref, buyer_email) values ('${id(35)}', 'CART_NGN1', 'buyer@example.com');
    update catalogue_orders set checkout_id = '${id(35)}' where id = '${id(30)}';
    insert into checkout_quotes (id, client_key, checkout_currency, checkout_route, lines, subtotal_minor, service_fee_minor, total_minor, expires_at)
      values ('${id(36)}', 'quote_ngn_0001', 'NGN', 'paystack', '[{"item_id": "${id(20)}", "quantity": 1, "listing_currency": "NGN",
        "listing_unit_minor": "1800000", "listing_line_minor": "1800000", "rate_per_usd": null, "checkout_currency": "NGN", "charged_minor": "1800000",
        "commission_percent": 5, "commission_minor": "90000", "seller_earnings_minor": "1710000", "settlement_currency": "NGN",
        "usd_equivalent_micro": "11250000"}]', 1800000, 0, 1800000, now() + interval '15 minutes');
  `);
  const snapshot = (overrides = {}) => {
    const row = { order_id: id(30), quote_id: id(36), listing_currency: 'NGN', listing_unit_minor: 1800000, quantity: 1, listing_line_minor: 1800000,
      checkout_currency: 'NGN', charged_minor: 1800000, commission_percent: 5, commission_minor: 90000, seller_earnings_minor: 1710000,
      settlement_currency: 'NGN', usd_equivalent_micro: 11250000, ...overrides };
    const cols = Object.keys(row);
    return db.query(`insert into order_financial_snapshots (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
  };
  // Review fixes: a snapshot needs a paid quote, and must match it exactly.
  await assert.rejects(snapshot(), /snapshot_quote_unpaid/);
  await db.query(`update checkout_quotes set payment_ref = 'CART_NGN1' where id = $1`, [id(36)]);
  await assert.rejects(db.query(`update checkout_quotes set total_minor = 1, subtotal_minor = 1 where id = $1`, [id(36)]), /checkout_quote_frozen/);
  await assert.rejects(db.query(`update checkout_quotes set payment_ref = 'OTHER' where id = $1`, [id(36)]), /checkout_quote_already_bound/);
  await assert.rejects(snapshot({ charged_minor: 1700000, seller_earnings_minor: 1610000 }), /snapshot_quote_mismatch|order_financial_snapshots_consistent/);
  await assert.rejects(snapshot({ quote_id: null }), /snapshot_quote_missing|null value/);
  await assert.rejects(snapshot({ checkout_currency: 'USD', settlement_currency: 'USD' }), /order_financial_snapshots_consistent|snapshot_currency_mismatch/);
  await assert.rejects(snapshot({ order_id: id(31) }), /snapshot_payment_mismatch/, 'an order from another payment cannot use this quote');
  await snapshot();
  await assert.rejects(snapshot(), /duplicate key|order_financial_snapshots_pkey/, 'one snapshot per order');
  const m = await one(`select * from order_money($1)`, [id(30)]);
  assert.deepEqual({ currency: m.currency, gross: Number(m.gross_micro), platform: Number(m.platform_micro), usd: Number(m.usd_gross_micro) },
    { currency: 'NGN', gross: 18000000000, platform: 900000000, usd: 11250000 }, '₦18,000 and ₦900 in ledger micro units');
  const legacy = await one(`select * from order_money($1)`, [id(31)]);
  assert.equal(legacy.currency, 'USD', 'orders without a snapshot stay USD');

  const earnings = (await db.query(`select * from seller_earnings_by_currency('ngnseller') order by currency`)).rows;
  assert.deepEqual(earnings.map((r) => [r.currency, Number(r.withdrawable_micro), Number(r.pending_micro)]),
    [['NGN', 17100000000, 0], ['USD', 0, 0]], 'NGN earnings counted in naira; the USD order has no seller_net yet');

  await assert.rejects(db.query(`update order_financial_snapshots set charged_minor = 1 where order_id = $1`, [id(30)]), /append_only/);
});

test('affiliate commission on a naira sale is owed in naira; payouts are per currency', async () => {
  await db.exec(`
    insert into affiliate_partners (id, participant_id, handle, display_name) values ('${id(40)}', '${id(11)}', 'partnerx', 'Partner X');
    insert into affiliate_offers (id, item_id, seller_username, funding, commission_percent) values ('${id(41)}', '${id(20)}', 'ngnseller', 'platform', 10);
    insert into affiliate_memberships (id, offer_id, partner_id, model, status, terms_version) values ('${id(42)}', '${id(41)}', '${id(40)}', 'referral', 'approved', 1);
    insert into affiliate_links (id, code, partner_id, target, membership_id) values ('${id(43)}', 'NGNLINK01', '${id(40)}', 'membership', '${id(42)}');
    update earnings_settings set platform_monthly_budget_micro = 100000000 where id;
  `);
  const click = (await one(`select affiliate_record_click('NGNLINK01', $1, 'v') as r`, [id(20)])).r;
  await db.query(`update affiliate_clicks set created_at = now() - interval '1 hour' where id = $1`, [click.click_id]);
  await db.query(`select affiliate_record_intent('ITEM_NGN1', 'paystack', null, $1::uuid[])`, [[click.click_id]]);
  await one(`select affiliate_match_intents()`);
  const at = await one(`select * from affiliate_attributions where order_id = $1`, [id(30)]);
  assert.equal(at.currency, 'NGN');
  // 10% of ₦18,000 = ₦1,800, capped at 50% of One Dream's ₦900 commission = ₦450.
  assert.equal(Number(at.commission_micro), 450000000);
  await one(`select affiliate_advance()`);
  const rows = (await db.query(`select * from partner_balances('participant', $1)`, [id(11)])).rows;
  const ngn = rows.find((r) => r.currency === 'NGN' && r.source === 'affiliate');
  assert.equal(Number(ngn.available), 450000000, '₦450 withdrawable, in naira');

  await db.exec(`update earnings_settings set payouts_enabled = true, min_payout_micro = 100000 where id;
    insert into currency_rates (quote, rate, source, source_published_at) values ('NGN', 1600, 'test', now());
    insert into payee_profiles (party_type, party_id, legal_name, country, date_of_birth, payout_method, kyc_status)
      values ('participant', '${id(11)}', 'Partner Person', 'NG', '1990-01-01', 'bank_transfer', 'verified');`);
  await assert.rejects(one(`select payout_request_create('participant', $1, 'affiliate', 450000000, 'po-ngn-00001', 'USD')`, [id(11)]), /insufficient_available_balance/,
    'naira earnings cannot be withdrawn as dollars');
  const r = (await one(`select payout_request_create('participant', $1, 'affiliate', 450000000, 'po-ngn-00002', 'NGN') as r`, [id(11)])).r;
  assert.equal((await one(`select currency from payout_requests where id = $1`, [r.request_id])).currency, 'NGN');
});

// ---------------------------------------------------------------------------
// Protected patches P8 + P9 (prepared, not applied in production): proven on
// the in-memory copy only.
// ---------------------------------------------------------------------------
test('P8 + P9: naira sales leave the USD wallet and are withdrawn in naira through the existing workflow', async () => {
  const fs = await import('node:fs/promises');
  const patch = (name) => fs.readFile(new URL(`../docs/protected-patches/${name}`, import.meta.url), 'utf8');
  await db.exec(`
    alter table catalogue_orders add column if not exists commission_percent numeric;
    create table if not exists participant_withdrawals (id uuid primary key default gen_random_uuid(), username text, amount_usd numeric,
      payment_method text, payment_details text, status text, created_at timestamptz default now(), source text);
    update catalogue_orders set commission_percent = 5, seller_net_usd = amount_usd - commission_usd where seller_username = 'ngnseller';
    update catalogue_orders set status = 'buyer_confirmed' where payment_ref = 'ITEM_USD1';
    insert into participant_withdrawals (username, amount_usd, status, source) values ('ngnseller', 5, 'paid', 'marketplace');
  `);
  const p8 = await patch('P8_usd_seller_wallet.sql');
  await db.exec(p8);
  assert.deepEqual((await db.query(p8.slice(p8.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
  const usd = await one(`select * from seller_earnings_summary('ngnseller')`);
  assert.equal(Number(usd.withdrawable_earned_usd), 19, 'only the $20 USD order (less $1 commission); the naira order is not in the USD wallet');
  assert.equal(Number(usd.available_usd), 14, 'less the existing $5 USD withdrawal');

  const p9 = await patch('P9_naira_seller_wallet.sql');
  await db.exec(p9);
  assert.deepEqual((await db.query(p9.slice(p9.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
  const fix = await fs.readFile(new URL('../supabase/fix_p8_p9_review.sql', import.meta.url), 'utf8');
  await db.exec(fix);
  assert.deepEqual((await db.query(fix.slice(fix.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), [], 'P8/P9 corrections verify');
  const ngn = await one(`select * from seller_earnings_summary_ngn('ngnseller')`);
  assert.equal(Number(ngn.available_ngn), 17100, '₦18,000 less ₦900 commission');
  await assert.rejects(one(`select * from request_seller_withdrawal_ngn($1, 17100.01, 'Bank transfer', 'GTB 0123456789')`, [id(10)]), /insufficient_balance/);
  const w = await one(`select * from request_seller_withdrawal_ngn($1, 10000, 'Bank transfer', 'GTB 0123456789')`, [id(10)]);
  assert.equal(Number(w.available_balance), 7100);
  const row = await one(`select currency, amount_ngn, amount_usd, status from participant_withdrawals where id = $1`, [w.withdrawal_id]);
  assert.deepEqual([row.currency, Number(row.amount_ngn), Number(row.amount_usd), row.status], ['NGN', 10000, 6.25, 'pending']);
  assert.equal(Number((await one(`select available_usd from seller_earnings_summary('ngnseller')`)).available_usd), 14, 'a naira withdrawal never touches the USD wallet');
  assert.equal(Number((await one(`select available_ngn from seller_earnings_summary_ngn('ngnseller')`)).available_ngn), 7100);
});

test('rollback: refuses once naira money exists; on a clean database it restores the previous earnings functions', async () => {
  const fs = await import('node:fs/promises');
  const read = (path) => fs.readFile(new URL(path, import.meta.url), 'utf8');
  const rollback = await read('../supabase/rollback_multicurrency_listings.sql');
  await assert.rejects(db.exec(rollback), /snapshots|quote was paid/);

  const fresh = await earningsTestDb();
  try {
    await fresh.db.exec(rollback);
    assert.equal((await fresh.db.query(`select to_regclass('public.marketplace_currencies') t`)).rows[0].t, null);
    for (const name of ['add_earnings_and_payouts.sql', 'add_gift_revenue_sharing.sql', 'add_affiliate_marketplace.sql']) {
      const sql = await read(`../supabase/${name}`);
      await fresh.db.exec(sql);
      assert.deepEqual((await fresh.db.query(sql.slice(sql.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), [], name);
    }
    const sig = (await fresh.db.query(`select to_regprocedure('public.partner_ledger_post(text,uuid,text,text,bigint,text,text,text,text,text,uuid)') p`)).rows[0].p;
    assert.ok(sig, 'the original ledger function is back');
    // And the migration can be applied again afterwards.
    const mc = await read('../supabase/add_multicurrency_listings.sql');
    await fresh.db.exec(mc);
    assert.deepEqual((await fresh.db.query(mc.slice(mc.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
  } finally {
    await fresh.db.close();
  }
});

test('review fixes: naira payout minimum needs a fresh rate; ledger moves are all-or-nothing; resale is USD only', async () => {
  await db.exec(`delete from currency_rates where quote = 'NGN'`);
  await assert.rejects(one(`select payout_request_create('participant', $1, 'affiliate', 1000000, 'po-ngn-norate', 'NGN')`, [id(11)]), /rate_unavailable/,
    'no fallback rate of 1');
  await db.exec(`insert into currency_rates (quote, rate, source, source_published_at) values ('NGN', 1600, 'test', now() - interval '3 days')`);
  await assert.rejects(one(`select payout_request_create('participant', $1, 'affiliate', 1000000, 'po-ngn-stale', 'NGN')`, [id(11)]), /rate_unavailable/,
    'a stale rate is refused too');
  await assert.rejects(one(`select payout_request_create('participant', $1, 'affiliate', 1000000, 'po-xyz', 'GBP')`, [id(11)]), /unsupported_currency/);
  await assert.rejects(one(`select * from request_seller_withdrawal_ngn($1, 100, 'Bank transfer', 'GTB 0123456789')`, [id(10)]), /rate_unavailable/,
    'a naira withdrawal is refused without a recent rate, never recorded as $0.01');

  // A credit that can't be posted rolls back the debit.
  await db.exec(`select partner_ledger_post('participant', '${id(11)}', 'affiliate', 'available', 7, 'adjust', 'test', 't', 'clash:to')`);
  const before = Number((await one(`select count(*)::int n from partner_ledger`)).n);
  await assert.rejects(one(`select partner_ledger_move('participant', $1, 'affiliate', 'pending', 'available', 5, 'adjust', 'test', 't', 'clash')`, [id(11)]),
    /ledger_move_credit_not_posted/);
  assert.equal(Number((await one(`select count(*)::int n from partner_ledger`)).n), before, 'nothing posted');
  await assert.rejects(one(`select partner_ledger_move('participant', $1, 'affiliate', 'pending', 'available', -5, 'adjust', 'test', 't', 'neg')`, [id(11)]),
    /ledger_move_amount_invalid/);
  assert.equal((await one(`select partner_ledger_move('participant', $1, 'affiliate', 'pending', 'available', 0, 'adjust', 'test', 't', 'zero') as r`, [id(11)])).r, false,
    'zero is still a no-op (e.g. a fully reversed gift)');

  await assert.rejects(db.query(`insert into affiliate_offers (item_id, seller_username, funding, commission_percent, allow_resale, resale_floor_usd, amount_currency)
    values ($1, 'ngnseller', 'platform', 10, true, 10, 'NGN')`, [id(20)]), /affiliate_offers_resale_usd/);
});

test('activation bundle (supabase/activate_all_2026_10_19.sql) applies in one transaction, verifies, and runs again', async () => {
  const fs = await import('node:fs/promises');
  const bundle = await fs.readFile(new URL('../supabase/activate_all_2026_10_19.sql', import.meta.url), 'utf8');
  // Tables the bundle touches that this in-memory copy doesn't otherwise model.
  await db.exec(`
    create table if not exists catalogue_checkouts (id uuid primary key default gen_random_uuid(), payment_ref text unique);
    alter table catalogue_items add column if not exists payment_methods jsonb not null default '["paystack", "usdt"]';
    alter table catalogue_orders add column if not exists checkout_id uuid;
    create table if not exists advertising_campaigns (id uuid primary key default gen_random_uuid());
    create table if not exists advertising_entitlements (id uuid primary key default gen_random_uuid());
    create table if not exists advertising_events (id bigint generated always as identity primary key, campaign_id uuid, kind text, viewer_key text, created_at timestamptz default now());
  `);
  const verification = bundle.slice(bundle.lastIndexOf('with checks('));
  for (let run = 1; run <= 2; run++) {
    await db.exec(bundle.slice(0, bundle.lastIndexOf('with checks(')));
    assert.deepEqual((await db.query(verification)).rows.filter((r) => !r.ok), [], `every check ok (run ${run})`);
  }
});
