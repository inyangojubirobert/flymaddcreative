// Runs real migration SQL in an isolated in-memory Postgres. No remote DB or charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { subscriptionTestStore, closeSubscriptionTestStore } from './lib/subscription-test-store.mjs';
test.after(closeSubscriptionTestStore);
import { googleSubscriptionRequest, monthlyGoogleOffer, googleSubscriptionManagementUrl } from '../mobile/src/lib/google-play-subscription.ts';

const account = '11111111-1111-4111-8111-111111111111';
const otherAccount = '22222222-2222-4222-8222-222222222222';
const pro = 'bascardo_ai_pro_monthly';
const business = 'bascardo_ai_business_monthly';
const earlier = new Date(Date.now() - 86400000).toISOString();
const future = new Date(Date.now() + 30 * 86400000).toISOString();
const later = new Date(Date.now() + 60 * 86400000).toISOString();
const observed = new Date().toISOString();

const context = vm.createContext({ console, Buffer, process: { env: {} } });
const synthetic = (values) => new vm.SyntheticModule(Object.keys(values), function () {
  for (const [key, value] of Object.entries(values)) this.setExport(key, value);
}, { context });
const definitions = { free: { id: 'free', monthlyCredits: 25 }, pro: { id: 'pro', monthlyCredits: 200 }, business: { id: 'business', monthlyCredits: 750 } };
const mocks = {
  crypto: synthetic({ default: crypto }),
  'google-auth-library': synthetic({ GoogleAuth: class {}, OAuth2Client: class {} }),
  './aiFeature': synthetic({ AI_PLAN_DEFINITIONS: definitions }),
  './currency': synthetic({ getUsdToNgnRate() {}, usdToKobo() {}, usdToNgn() {} }),
};
const module = new vm.SourceTextModule(await fs.readFile(new URL('../lib/aiPayments.js', import.meta.url), 'utf8'), { context });
await module.link((specifier) => mocks[specifier]);
await module.evaluate();
const api = module.namespace;

function payload(productId = pro, changes = {}) {
  return {
    startTime: earlier, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: account },
    lineItems: [{ productId, expiryTime: future, autoRenewingPlan: { autoRenewEnabled: true } }],
    ...changes,
  };
}
async function sync(store, token, data, time = observed, id = account) {
  return api.syncGooglePlayEntitlement(store, id, token, api.parseGooglePlaySubscription(data, time));
}

// Exercise the public verification path with isolated environment and auth doubles.
async function verifyWithCredentials(env) {
  let authOptions;
  const authContext = vm.createContext({
    process: { env },
    fetch: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-access-token');
      return { ok: true, json: async () => payload() };
    },
  });
  const mock = (values) => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context: authContext });
  const imports = {
    crypto: mock({ default: crypto }),
    'google-auth-library': mock({
      GoogleAuth: class {
        constructor(options) { authOptions = options; }
        async getClient() { return { getAccessToken: async () => ({ token: 'test-access-token' }) }; }
      },
      OAuth2Client: class {},
    }),
    './aiFeature': mock({ AI_PLAN_DEFINITIONS: definitions }),
    './currency': mock({ getUsdToNgnRate() {}, usdToKobo() {}, usdToNgn() {} }),
  };
  const paymentModule = new vm.SourceTextModule(await fs.readFile(new URL('../lib/aiPayments.js', import.meta.url), 'utf8'), { context: authContext });
  await paymentModule.link((specifier) => imports[specifier]);
  await paymentModule.evaluate();
  const verified = await paymentModule.namespace.verifyGooglePlaySubscription('test-purchase-token');
  assert.equal(verified.planId, 'pro');
  assert.equal(authOptions.scopes[0], 'https://www.googleapis.com/auth/androidpublisher');
  return authOptions.credentials;
}

const testPrivateKey = '-----BEGIN PRIVATE KEY-----\ntest-only-key\n-----END PRIVATE KEY-----\n';
const separateCredentials = {
  GOOGLE_PROJECT_ID: 'test-project',
  GOOGLE_CLIENT_EMAIL: 'billing@test-project.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: testPrivateKey,
};

test('separate backend credentials authenticate with escaped or actual key newlines', async () => {
  for (const key of [testPrivateKey, testPrivateKey.replace(/\n/g, '\\n')]) {
    const credentials = await verifyWithCredentials({ ...separateCredentials, GOOGLE_PRIVATE_KEY: key });
    assert.equal(credentials.project_id, separateCredentials.GOOGLE_PROJECT_ID);
    assert.equal(credentials.client_email, separateCredentials.GOOGLE_CLIENT_EMAIL);
    assert.equal(credentials.private_key, testPrivateKey);
    assert.equal(credentials.type, 'service_account');
  }
});

test('separate credentials take precedence over an old invalid JSON entry', async () => {
  const credentials = await verifyWithCredentials({ ...separateCredentials, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: 'invalid-json' });
  assert.equal(credentials.client_email, separateCredentials.GOOGLE_CLIENT_EMAIL);
});

test('JSON credentials remain supported when separate variables are unset', async () => {
  const credentials = await verifyWithCredentials({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: 'service_account', project_id: 'json-project', client_email: 'json@example.test',
    private_key: testPrivateKey.replace(/\n/g, '\\n'),
  }) });
  assert.equal(credentials.client_email, 'json@example.test');
  assert.equal(credentials.private_key, testPrivateKey);
});

test('incomplete separate credentials never fall back to another service account', async () => {
  for (const missing of Object.keys(separateCredentials)) {
    const env = { ...separateCredentials, GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'other@example.test', private_key: testPrivateKey }) };
    delete env[missing];
    await assert.rejects(verifyWithCredentials(env), /google_play_not_configured/);
  }
});

test('missing or malformed credentials produce configuration errors without exposing their values', async () => {
  await assert.rejects(verifyWithCredentials({}), /google_play_not_configured/);
  await assert.rejects(verifyWithCredentials({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: 'invalid-secret-value' }), { message: 'invalid_google_play_credentials' });
});

test('old expiry, hold, and repeated restore cannot remove or resurrect a replaced plan', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'old', payload());
  await sync(store, 'new', payload(business, { linkedPurchaseToken: 'old' }));
  for (const state of ['SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_ACTIVE']) {
    const result = await sync(store, 'old', payload(pro, { subscriptionState: state }), later);
    assert.equal(result.plan, 'business');
  }
  const revoked = await sync(store, 'new', payload(business, { linkedPurchaseToken: 'old', subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }), later);
  assert.equal(revoked.plan, 'free');
});

test('deferred downgrade retains Business for either line-item order, then grants Pro at renewal', async () => {
  for (const reverse of [false, true]) {
    const store = await subscriptionTestStore([account]);
    await sync(store, 'business-old', payload(business));
    const items = [
      { productId: business, expiryTime: future, deferredItemReplacement: { productId: pro } },
      { productId: pro },
    ];
    const deferred = payload(pro, { linkedPurchaseToken: 'business-old', lineItems: reverse ? items.reverse() : items });
    const verified = api.parseGooglePlaySubscription(deferred);
    assert.equal(verified.productId, business);
    assert.equal(verified.pendingProductId, pro);
    assert.equal((await sync(store, 'new', deferred)).plan, 'business');
    assert.equal((await sync(store, 'business-old', payload(business, { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }), later)).plan, 'business');
    const renewal = payload(pro, { linkedPurchaseToken: 'business-old', lineItems: [{ productId: pro, expiryTime: later }] });
    assert.equal((await sync(store, 'new', renewal, later)).plan, 'pro');
  }
});

test('independent lower-tier events preserve a valid Business subscription', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'business', payload(business));
  await sync(store, 'pro', payload());
  assert.equal((await sync(store, 'pro', payload(pro, { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }), later)).plan, 'business');
});

test('pending replacement grants no new access and leaves the paid old subscription intact', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'pro', payload());
  const pending = payload(business, { startTime: undefined, linkedPurchaseToken: 'pro', subscriptionState: 'SUBSCRIPTION_STATE_PENDING', lineItems: [{ productId: business }] });
  assert.equal((await sync(store, 'pending', pending)).plan, 'pro');
  assert.equal((await sync(store, 'pending', payload(business, { linkedPurchaseToken: 'pro' }), later)).plan, 'business');
});

test('cancelled and grace-period access lasts until expiry; holds and revocations remove access', async () => {
  for (const state of ['SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING']) {
    const store = await subscriptionTestStore([account]);
    const result = await sync(store, 'token', payload(pro, { subscriptionState: state }));
    assert.equal(result.plan, ['SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'].includes(state) ? 'pro' : 'free');
  }
});

test('a delayed verification response cannot overwrite a newer response for the same token', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'token', payload(business), observed);
  const result = await sync(store, 'token', payload(pro, { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }), earlier);
  assert.equal(result.plan, 'business');
});

test('linked ownership conflicts roll back the new purchase, and unseen retired tokens are reserved', async () => {
  const store = await subscriptionTestStore([account, otherAccount]);
  await sync(store, 'old', payload());
  const other = payload(business, { externalAccountIdentifiers: { obfuscatedExternalAccountId: otherAccount }, linkedPurchaseToken: 'old' });
  await assert.rejects(sync(store, 'new', other, observed, otherAccount), /payment_already_claimed/);
  assert.equal((await store.sql.query("select count(*)::int n from ai_provider_subscriptions where participant_id = $1", [otherAccount])).rows[0].n, 0);
  await sync(store, 'new', payload(business, { linkedPurchaseToken: 'unseen-old' }));
  await assert.rejects(sync(store, 'unseen-old', { ...other, linkedPurchaseToken: null }, later, otherAccount), /payment_already_claimed/);
  assert.equal((await sync(store, 'unseen-old', payload(), later)).plan, 'business');
});

test('Google account binding rejects a receipt submitted by another signed-in user', async () => {
  const store = await subscriptionTestStore([account, otherAccount]);
  await assert.rejects(sync(store, 'token', payload(), observed, otherAccount), /payment_account_mismatch/);
});

test('read-time expiry selects another valid plan without waiting for a notification', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'pro', payload());
  await sync(store, 'business', payload(business));
  await store.sql.query("update ai_provider_subscriptions set current_period_end = now() - interval '1 second' where plan = 'business'");
  assert.equal((await store.rpc('get_ai_subscription_entitlement', { p_participant_id: account })).data.plan, 'pro');
});

test('an old Paystack cancellation cannot remove active Google access', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'business', payload(business));
  const result = await api.applyAiSubscriptionEntitlement(store, { participantId: account, provider: 'paystack', providerReference: 'SUB_old', plan: 'pro', status: 'expired', currentPeriodStart: earlier, currentPeriodEnd: future });
  assert.equal(result.plan, 'business');
});

test('public and signed-in database roles cannot call subscription mutation or inspect receipts', async () => {
  const store = await subscriptionTestStore([account]);
  for (const role of ['anon', 'authenticated']) {
    await store.sql.exec(`set role ${role}`);
    try {
      await assert.rejects(store.sql.query('select sync_ai_provider_subscription($1::jsonb)', ['{}']), /permission denied/);
      await assert.rejects(store.sql.query('select get_ai_subscription_entitlement($1)', [account]), /permission denied/);
      await assert.rejects(store.sql.query('select * from ai_provider_subscriptions'), /permission denied/);
    } finally { await store.sql.exec('reset role'); }
  }
});

test('migration can be applied again without reviving retired tokens', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'old', payload());
  await sync(store, 'new', payload(business, { linkedPurchaseToken: 'old' }));
  await store.sql.exec(await fs.readFile(new URL('../supabase/add_ai_provider_subscriptions.sql', import.meta.url), 'utf8'));
  assert.equal((await store.rpc('get_ai_subscription_entitlement', { p_participant_id: account })).data.plan, 'business');
});

async function notificationHandler(store, verified, authenticate = true) {
  const calls = { verifications: 0, acknowledgements: 0 };
  const routeContext = vm.createContext({ Buffer, process: { env: {} }, console: { error() {} } });
  const mock = (values) => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context: routeContext });
  const imports = {
    '@supabase/supabase-js': mock({ createClient: () => store }),
    '../../../../lib/aiPayments': mock({ ...api,
      verifyGooglePubSubIdentity: async () => authenticate,
      verifyGooglePlaySubscription: async () => { calls.verifications++; return verified; },
      acknowledgeGooglePlaySubscription: async () => { calls.acknowledgements++; },
    }),
  };
  const route = new vm.SourceTextModule(await fs.readFile(new URL('../pages/api/onedream/ai-subscription/google-play-notification.js', import.meta.url), 'utf8'), { context: routeContext });
  await route.link((specifier) => imports[specifier]); await route.evaluate();
  return {
    calls,
    async notify(packageName = api.GOOGLE_PLAY_PACKAGE_NAME) {
      const response = { code: null, status(code) { this.code = code; return this; }, json() { return this; }, end() { return this; } };
      const data = Buffer.from(JSON.stringify({ packageName, subscriptionNotification: { purchaseToken: 'new-token' } })).toString('base64');
      await route.namespace.default({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { message: { data } } }, response);
      return response.code;
    },
  };
}

test('RTDN verifies, links and acknowledges a purchase before any client verification arrives', async () => {
  const store = await subscriptionTestStore([account]);
  const verified = api.parseGooglePlaySubscription(payload(pro, { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' }));
  const route = await notificationHandler(store, verified);
  assert.equal(await route.notify(), 204);
  assert.equal(route.calls.acknowledgements, 1);
  assert.equal((await store.rpc('get_ai_subscription_entitlement', { p_participant_id: account })).data.plan, 'pro');
});

test('RTDN handles deferred replacement through the linked owner even without external account IDs', async () => {
  const store = await subscriptionTestStore([account]);
  await sync(store, 'old', payload(business));
  const verified = api.parseGooglePlaySubscription(payload(business, { externalAccountIdentifiers: undefined, linkedPurchaseToken: 'old' }));
  const route = await notificationHandler(store, verified);
  assert.equal(await route.notify(), 204);
  assert.equal((await store.rpc('get_ai_subscription_entitlement', { p_participant_id: account })).data.plan, 'business');
});

test('RTDN never acknowledges a pending payment, and retries an unknown owner', async () => {
  const store = await subscriptionTestStore([account]);
  const pending = api.parseGooglePlaySubscription(payload(pro, { subscriptionState: 'SUBSCRIPTION_STATE_PENDING', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' }));
  const route = await notificationHandler(store, pending);
  assert.equal(await route.notify(), 204);
  assert.equal(route.calls.acknowledgements, 0);
  assert.equal((await store.rpc('get_ai_subscription_entitlement', { p_participant_id: account })).data.plan, 'free');
  await store.sql.exec('truncate ai_provider_subscriptions');
  const unknown = await notificationHandler(store, { ...pending, externalAccountId: null });
  assert.equal(await unknown.notify(), 503);
});

test('RTDN rejects invalid identity and wrong packages before Google or database work', async () => {
  const store = await subscriptionTestStore([account]);
  const denied = await notificationHandler(store, api.parseGooglePlaySubscription(payload()), false);
  assert.equal(await denied.notify(), 401);
  assert.equal(denied.calls.verifications, 0);
  const wrongPackage = await notificationHandler(store, api.parseGooglePlaySubscription(payload()));
  assert.equal(await wrongPackage.notify('another.app'), 400);
  assert.equal(wrongPackage.calls.verifications, 0);
});

const baseOffer = { basePlanId: 'monthly', offerId: null, offerToken: 'monthly-token', pricingPhases: { pricingPhaseList: [{ formattedPrice: '$9.00', billingPeriod: 'P1M', recurrenceMode: 1 }] } };
const product = (id) => ({ id, platform: 'android', subscriptionOfferDetailsAndroid: [baseOffer] });
const overview = (subscriptions = []) => ({ storeProducts: { googlePlay: { pro, business } }, billing: { integrationVersion: 2, subscriptions } });
const purchase = (productId, purchaseToken = 'old-token') => ({ productId, purchaseToken, purchaseState: 'purchased' });

test('new purchase has one monthly offer; upgrade replaces old token with proration; downgrade is deferred', () => {
  const first = googleSubscriptionRequest(product(pro), [], overview(), account);
  assert.equal(first.request.request.google.purchaseTokenAndroid, undefined);
  assert.equal(first.request.request.google.subscriptionOffers.length, 1);
  const upgrade = googleSubscriptionRequest(product(business), [purchase(pro)], overview(), account);
  assert.equal(upgrade.request.request.google.purchaseTokenAndroid, 'old-token');
  assert.equal(upgrade.request.request.google.replacementModeAndroid, 2);
  const downgrade = googleSubscriptionRequest(product(pro), [purchase(business)], overview(), account);
  assert.equal(downgrade.request.request.google.purchaseTokenAndroid, 'old-token');
  assert.equal(downgrade.request.request.google.replacementModeAndroid, 6);
  assert.equal(downgrade.deferred, true);
});

test('pending, duplicate, wrong-store, missing-token and undeployed-backend purchases fail closed', () => {
  const attempts = [
    [[{ ...purchase(pro), purchaseState: 'pending' }], overview()],
    [[purchase(pro), purchase(business, 'another-token')], overview()],
    [[purchase(pro, null)], overview()],
    [[], overview([{ provider: 'google_play', product_id: business, status: 'active' }])],
    [[], overview([{ provider: 'paystack', status: 'active' }])],
    [[purchase(business)], overview([{ provider: 'google_play', pending_product_id: pro }])],
    [[purchase(business)], overview([{ provider: 'google_play', status: 'past_due' }])],
    [[], { storeProducts: { googlePlay: { pro, business } } }],
  ];
  for (const [purchases, state] of attempts) assert.throws(() => googleSubscriptionRequest(product(pro), purchases, state, account));
});

test('offer selection rejects ambiguous monthly plans and ignores trials and annual plans', () => {
  const item = product(pro);
  item.subscriptionOfferDetailsAndroid.push({ ...baseOffer, offerId: 'trial' }, { ...baseOffer, pricingPhases: { pricingPhaseList: [{ billingPeriod: 'P1Y', recurrenceMode: 1 }] } });
  assert.equal(monthlyGoogleOffer(item).offerToken, 'monthly-token');
  item.subscriptionOfferDetailsAndroid.push({ ...baseOffer, basePlanId: 'another-monthly' });
  assert.equal(monthlyGoogleOffer(item), undefined);
});

test('management opens the known subscription or falls back to the subscription center', () => {
  assert.equal(googleSubscriptionManagementUrl(), 'https://play.google.com/store/account/subscriptions');
  assert.equal(googleSubscriptionManagementUrl(pro), `https://play.google.com/store/account/subscriptions?sku=${pro}&package=com.flymaddcreative.onedream`);
});
