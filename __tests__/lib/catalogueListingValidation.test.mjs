// Run: node --test __tests__/lib/catalogueListingValidation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateListingFields, parsePriceUsd } from '../../lib/catalogueListingValidation.js';

const CATEGORY = '9b2f3c1e-0000-4000-8000-000000000001';
const base = { title: 'Leather bag', price_usd: 15, category_id: CATEGORY };

test('accepts the mobile app create payload unchanged in meaning', () => {
  const { payload, error } = validateListingFields({
    title: '  Leather bag ',
    description: '',
    size: null,
    category_id: CATEGORY,
    price_usd: 15,
    promo_video_url: null,
    images: ['https://example.supabase.co/storage/v1/object/public/a/b.jpg'],
    payment_methods: ['paystack', 'usdt'],
    status: 'active',
  }, { isCreate: true });
  assert.equal(error, undefined);
  assert.deepEqual(payload, {
    title: 'Leather bag',
    price_usd: 15,
    description: '',
    size: null,
    promo_video_url: null,
    images: ['https://example.supabase.co/storage/v1/object/public/a/b.jpg'],
    payment_methods: ['paystack', 'usdt'],
    status: 'active',
    category_id: CATEGORY,
  });
});

test('accepts the website payload with a numeric-string price', () => {
  const { payload, error } = validateListingFields({ ...base, price_usd: '1.99', status: 'paused' }, { isCreate: true });
  assert.equal(error, undefined);
  assert.equal(payload.price_usd, 1.99);
  assert.equal(payload.status, 'paused');
});

test('rejects every invalid price form', () => {
  for (const price of [0, -1, -0.01, '0', 'abc', 'NaN', 'Infinity', NaN, Infinity, null, '', true, {}, [], 0.004]) {
    const { error } = validateListingFields({ ...base, price_usd: price }, { isCreate: true });
    assert.ok(error, `price ${String(price)} should be rejected`);
  }
});

test('rounds prices to cents', () => {
  assert.equal(parsePriceUsd(10.005), 10.01);
  assert.equal(parsePriceUsd('2.499'), 2.5);
});

test('requires title, price and category on create', () => {
  assert.ok(validateListingFields({ price_usd: 1, category_id: CATEGORY }, { isCreate: true }).error);
  assert.ok(validateListingFields({ title: 'x', category_id: CATEGORY }, { isCreate: true }).error);
  assert.ok(validateListingFields({ title: 'x', price_usd: 1 }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, category_id: '' }, { isCreate: true }).error);
});

test('only active and paused statuses are accepted; deletion is not a status edit', () => {
  for (const status of ['deleted', 'draft', '', null, 'ACTIVE']) {
    assert.ok(validateListingFields({ ...base, status }, { isCreate: true }).error, `status ${status}`);
  }
  assert.equal(validateListingFields(base, { isCreate: true }).payload.status, 'active');
});

test('ignores server-controlled fields such as seller_username and id', () => {
  const { payload } = validateListingFields(
    { ...base, seller_username: 'someone_else', id: 'x', created_at: '2000-01-01', updated_at: 'x' },
    { isCreate: true },
  );
  assert.equal('seller_username' in payload, false);
  assert.equal('id' in payload, false);
  assert.equal('created_at' in payload, false);
  assert.equal('updated_at' in payload, false);
});

test('PATCH only includes fields that were sent', () => {
  const { payload, error } = validateListingFields({ id: 'x', title: 'New title' }, { isCreate: false });
  assert.equal(error, undefined);
  assert.deepEqual(payload, { title: 'New title' });
});

test('PATCH validates a price when one is sent', () => {
  assert.ok(validateListingFields({ price_usd: 0 }, { isCreate: false }).error);
  assert.equal(validateListingFields({ price_usd: 3 }, { isCreate: false }).payload.price_usd, 3);
});

test('payment methods must be a non-empty known subset', () => {
  assert.ok(validateListingFields({ ...base, payment_methods: [] }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, payment_methods: ['cash'] }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, payment_methods: 'paystack' }, { isCreate: true }).error);
  assert.deepEqual(
    validateListingFields({ ...base, payment_methods: ['usdt', 'usdt'] }, { isCreate: true }).payload.payment_methods,
    ['usdt'],
  );
});

test('images and video links must be http(s) and are normalized', () => {
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,xx', 'not a url', 42]) {
    assert.ok(validateListingFields({ ...base, images: [url] }, { isCreate: true }).error, `image ${url}`);
  }
  assert.ok(validateListingFields({ ...base, promo_video_url: 'javascript:alert(1)' }, { isCreate: true }).error);
  const { payload } = validateListingFields({ ...base, images: ['https://x.test/a"onerror="b.jpg'] }, { isCreate: true });
  assert.equal(payload.images[0].includes('"'), false);
});

test('refuses HTML markup in text fields', () => {
  assert.ok(validateListingFields({ ...base, title: '<img src=x onerror=alert(1)>' }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, description: 'hi <script>x</script>' }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, size: '<b>XL</b>' }, { isCreate: true }).error);
  assert.equal(validateListingFields({ ...base, title: 'Tom & Jerry "deluxe" bag' }, { isCreate: true }).error, undefined);
});

test('length limits', () => {
  assert.ok(validateListingFields({ ...base, title: 'a'.repeat(121) }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, description: 'a'.repeat(5001) }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, images: Array(11).fill('https://x.test/a.jpg') }, { isCreate: true }).error);
});
