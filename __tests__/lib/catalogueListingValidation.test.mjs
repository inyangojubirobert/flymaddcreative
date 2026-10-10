// Run: node --test __tests__/lib/catalogueListingValidation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateListingFields, validateListingDraftFields, parsePriceUsd } from '../../lib/catalogueListingValidation.js';

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

test('new listings require an explicit product or service type when enabled', () => {
  assert.ok(validateListingFields(base, { isCreate: true, requireListingType: true }).error);
  assert.equal(
    validateListingFields({ ...base, listing_type: 'service' }, { isCreate: true, requireListingType: true }).payload.listing_type,
    'service',
  );
  assert.ok(validateListingFields({ ...base, listing_type: 'subscription' }, { isCreate: true, requireListingType: true }).error);
});

test('validates listing pricing metadata without accepting unknown values', () => {
  const valid = validateListingFields({
    ...base,
    listing_type: 'product',
    pricing_model: 'per_unit',
    price_unit: 'kg',
    product_details: { condition: 'new', fulfillment_methods: ['pickup', 'digital_delivery'] },
    attributes: [{ custom_label: 'Pack size', value: '5 kg' }],
  }, { isCreate: true, requireListingType: true });
  assert.equal(valid.error, undefined);
  assert.equal(valid.payload.pricing_model, 'per_unit');
  assert.deepEqual(valid.payload.product_details.fulfillment_methods, ['pickup', 'digital_delivery']);
  assert.ok(validateListingFields({ ...base, listing_type: 'product', pricing_model: 'Not a key!' }, { isCreate: true, requireListingType: true }).error);
  assert.ok(validateListingFields({ ...base, listing_type: 'product', product_details: { condition: 'fake' } }, { isCreate: true, requireListingType: true }).error);
});

test('validates service scope, confirmation, details and typed attributes', () => {
  const valid = validateListingFields({
    ...base,
    listing_type: 'service',
    pricing_model: 'per_session',
    service_scope: 'One 60 minute consultation with written follow-up.',
    service_terms: 'Online appointment scheduled after contacting the provider.',
    service_scope_confirmed: true,
    service_details: { service_modes: ['remote'], typical_duration_minutes: 60 },
    attributes: [{ attribute_id: 'definition-id', value: 60 }],
  }, { isCreate: true, requireListingType: true });
  assert.equal(valid.error, undefined);
  assert.equal(valid.payload.service_scope_confirmed, true);
  assert.ok(validateListingFields({ ...base, service_details: { experience_years: -1 } }, { isCreate: true }).error);
  assert.ok(validateListingFields({ ...base, attributes: [{ custom_label: 'bad', value: { nested: true } }] }, { isCreate: true }).error);
});

test('accepts extensible listing drafts without treating them as live listings', () => {
  const { payload, error } = validateListingDraftFields({
    title: 'Custom furniture order',
    listing_type: 'product',
    pricing_model: 'custom_quote',
    price_usd: null,
    price_max_usd: null,
    min_order_qty: 5,
    stock_status: 'made_to_order',
    stock_quantity: 0,
    images: [],
    product_details: { fulfillment_methods: ['delivery'] },
    pricing_options: [{ label: 'Bulk order', price_usd: '25.50', price_unit: 'other:bundle' }],
  });
  assert.equal(error, undefined);
  assert.equal(payload.price_usd, null);
  assert.equal(payload.min_order_qty, 5);
  assert.equal(payload.stock_status, 'made_to_order');
  assert.deepEqual(payload.pricing_options, [{ label: 'Bulk order', price_usd: 25.5, price_unit: 'other:bundle' }]);
});

test('rejects unsafe or inconsistent listing draft values', () => {
  const baseDraft = { title: 'Draft service', listing_type: 'service', pricing_model: 'hourly' };
  assert.ok(validateListingDraftFields({ ...baseDraft, price_usd: -1 }).error);
  assert.ok(validateListingDraftFields({ ...baseDraft, price_usd: 10, price_max_usd: 9 }).error);
  assert.ok(validateListingDraftFields({ ...baseDraft, min_order_qty: 3, max_order_qty: 2 }).error);
  assert.ok(validateListingDraftFields({ ...baseDraft, stock_status: 'available-ish' }).error);
  assert.ok(validateListingDraftFields({ ...baseDraft, pricing_options: [{ label: '<script>' }] }).error);
  assert.ok(validateListingDraftFields({ ...baseDraft, status: 'active' }).error);
  assert.ok(validateListingDraftFields({ listing_type: 'service', pricing_model: 'hourly' }).error);
});
