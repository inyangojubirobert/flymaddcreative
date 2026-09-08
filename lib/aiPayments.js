import crypto from 'crypto';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { AI_PLAN_DEFINITIONS } from './aiFeature';
import { getUsdToNgnRate, usdToKobo, usdToNgn } from './currency';

export const GOOGLE_PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.flymaddcreative.onedream';

export const GOOGLE_PLAY_AI_PRODUCTS = {
  pro: process.env.GOOGLE_PLAY_AI_PRO_PRODUCT_ID || 'bascardo_ai_pro_monthly',
  business: process.env.GOOGLE_PLAY_AI_BUSINESS_PRODUCT_ID || 'bascardo_ai_business_monthly',
};

const PAYSTACK_PLAN_NAMES = {
  pro: 'Bascardo AI Pro Monthly',
  business: 'Bascardo AI Business Monthly',
};

const ACTIVE_GOOGLE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

function requirePaidPlan(planId) {
  const plan = AI_PLAN_DEFINITIONS[planId];
  if (!plan || plan.id === 'free') throw new Error('invalid_ai_plan');
  return plan;
}

function addOneMonth(value) {
  const date = new Date(value || Date.now());
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

function paystackHeaders() {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error('paystack_not_configured');
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  };
}

export function safePaymentReference(provider, value) {
  const reference = String(value || '');
  return provider === 'google_play'
    ? crypto.createHash('sha256').update(reference).digest('hex')
    : reference.slice(0, 240);
}

export function planFromGoogleProductId(productId) {
  return Object.entries(GOOGLE_PLAY_AI_PRODUCTS).find(([, value]) => value === productId)?.[0] || null;
}

export function planFromPaystackData(data) {
  const metadataPlan = String(data?.metadata?.ai_plan || '').toLowerCase();
  if (metadataPlan === 'pro' || metadataPlan === 'business') return metadataPlan;

  const planName = String(data?.plan_object?.name || data?.plan?.name || '').toLowerCase();
  return Object.entries(PAYSTACK_PLAN_NAMES).find(([, name]) => name.toLowerCase() === planName)?.[0] || null;
}

export async function getPaystackAiAmount(planId) {
  const plan = requirePaidPlan(planId);
  const rate = Number(await getUsdToNgnRate());
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid_ai_subscription_rate');
  return {
    currency: 'NGN',
    amountMinor: usdToKobo(plan.priceUsd, rate),
    amountNgn: usdToNgn(plan.priceUsd, rate),
    exchangeRate: rate,
  };
}

export async function getOrCreatePaystackAiPlan(planId) {
  const plan = requirePaidPlan(planId);
  const envName = planId === 'pro' ? 'PAYSTACK_AI_PRO_PLAN_CODE' : 'PAYSTACK_AI_BUSINESS_PLAN_CODE';
  const configuredCode = process.env[envName];
  const pricing = await getPaystackAiAmount(planId);
  const expectedName = PAYSTACK_PLAN_NAMES[planId];
  const matchesQuote = (item) => (
    item?.name === expectedName
    && item.interval === 'monthly'
    && item.currency === pricing.currency
    && Number(item.amount) === pricing.amountMinor
  );
  if (configuredCode) {
    const response = await fetch(`https://api.paystack.co/plan/${encodeURIComponent(configuredCode)}`, { headers: paystackHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status) throw new Error('paystack_plan_lookup_failed');
    if (matchesQuote(payload.data)) return { planCode: payload.data.plan_code, ...pricing };
    // Never reprice a shared plan: existing subscribers retain their agreed NGN amount.
  }

  const listResponse = await fetch(`https://api.paystack.co/plan?perPage=100&status=active&interval=monthly&amount=${pricing.amountMinor}`, {
    headers: paystackHeaders(),
  });
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok || !listPayload.status) {
    throw new Error(listPayload.message || 'paystack_plan_lookup_failed');
  }

  const existing = (listPayload.data || []).find(matchesQuote);
  if (existing?.plan_code) return { planCode: existing.plan_code, ...pricing };

  const createResponse = await fetch('https://api.paystack.co/plan', {
    method: 'POST',
    headers: paystackHeaders(),
    body: JSON.stringify({
      name: expectedName,
      description: `${plan.name} access to Bascardo AI`,
      amount: pricing.amountMinor,
      interval: 'monthly',
      currency: pricing.currency,
      send_invoices: true,
      send_sms: false,
    }),
  });
  const createPayload = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !createPayload.status || !createPayload.data?.plan_code) {
    throw new Error(createPayload.message || 'paystack_plan_creation_failed');
  }
  return { planCode: createPayload.data.plan_code, ...pricing };
}

export async function initializePaystackAiSubscription(supabase, participant, planId, callbackUrl) {
  const plan = requirePaidPlan(planId);
  const paystackPlan = await getOrCreatePaystackAiPlan(planId);
  const reference = `BASCARDO_${planId.toUpperCase()}_${participant.id.slice(0, 8)}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  // Save the server-generated quote before giving the customer a checkout URL.
  // Verification must not compare a completed charge with a newer FX rate.
  await recordAiSubscriptionTransaction(supabase, {
    participantId: participant.id,
    provider: 'paystack',
    providerReference: reference,
    productId: paystackPlan.planCode,
    plan: plan.id,
    status: 'pending',
    amountMinor: paystackPlan.amountMinor,
    currency: paystackPlan.currency,
  });
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: paystackHeaders(),
    body: JSON.stringify({
      email: participant.email,
      amount: paystackPlan.amountMinor,
      currency: paystackPlan.currency,
      reference,
      plan: paystackPlan.planCode,
      callback_url: callbackUrl,
      metadata: {
        type: 'bascardo_ai_subscription',
        participant_id: participant.id,
        participant_username: participant.username,
        ai_plan: plan.id,
        plan_code: paystackPlan.planCode,
        price_usd: plan.priceUsd,
        exchange_rate: paystackPlan.exchangeRate,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.status || !payload.data?.authorization_url || payload.data.reference !== reference) {
    throw new Error(payload.message || 'paystack_initialization_failed');
  }
  return {
    authorizationUrl: payload.data.authorization_url,
    reference: payload.data.reference,
    planCode: paystackPlan.planCode,
    amountNgn: paystackPlan.amountNgn,
    currency: paystackPlan.currency,
    exchangeRate: paystackPlan.exchangeRate,
  };
}

export async function fetchPaystackTransaction(reference) {
  const cleanReference = encodeURIComponent(String(reference || '').slice(0, 240));
  if (!cleanReference) throw new Error('missing_payment_reference');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${cleanReference}`, {
    headers: paystackHeaders(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || 'paystack_verification_failed');
  }
  return payload.data;
}

export function verifyPaystackTransactionDetails(transaction, participantId, expectedPlanId, expectedPlanCode, expectedAmount, { renewal = false } = {}) {
  if (transaction.status !== 'success') throw new Error('payment_not_successful');
  if (!renewal || transaction.metadata?.type === 'bascardo_ai_subscription') {
    if (transaction.metadata?.type !== 'bascardo_ai_subscription') throw new Error('invalid_payment_type');
    if (String(transaction.metadata?.participant_id) !== String(participantId)) throw new Error('payment_account_mismatch');
    if (String(transaction.metadata?.ai_plan) !== String(expectedPlanId)) throw new Error('payment_plan_mismatch');
  }

  const paidPlanCode = transaction.plan_object?.plan_code || transaction.plan?.plan_code || transaction.metadata?.plan_code;
  if (expectedPlanCode && (!renewal || paidPlanCode) && paidPlanCode !== expectedPlanCode) throw new Error('payment_plan_code_mismatch');
  if (String(transaction.currency).toUpperCase() !== String(expectedAmount.currency).toUpperCase()) throw new Error('payment_currency_mismatch');
  if (Number(transaction.amount) !== Number(expectedAmount.amountMinor)) throw new Error('payment_amount_mismatch');
}

export async function getPaystackAiPaymentQuote(supabase, participantId, transaction) {
  const fields = 'id, participant_id, provider_reference, provider_subscription_id, product_id, plan, status, amount_minor, currency';
  const { data: checkout, error } = await supabase.from('ai_subscription_transactions')
    .select(fields).eq('provider', 'paystack').eq('provider_reference', transaction.reference).maybeSingle();
  if (error) throw error;
  if (checkout && checkout.participant_id !== participantId) throw new Error('payment_account_mismatch');

  let stored = checkout;
  const code = transaction.subscription?.subscription_code || transaction.subscription_code;
  if (!stored && code) {
    const result = await supabase.from('ai_subscription_transactions').select(fields)
      .eq('provider', 'paystack').eq('participant_id', participantId).eq('provider_subscription_id', code)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (result.error) throw result.error;
    stored = result.data;
  }
  if (!stored || !stored.product_id || !Number.isSafeInteger(Number(stored.amount_minor)) || Number(stored.amount_minor) <= 0) {
    throw new Error('payment_quote_not_found');
  }
  if (code && stored.provider_subscription_id && code !== stored.provider_subscription_id) throw new Error('payment_subscription_mismatch');
  if (['refunded', 'failed'].includes(stored.status)) throw new Error('payment_not_successful');
  return {
    planId: stored.plan, planCode: stored.product_id,
    amountMinor: Number(stored.amount_minor), currency: stored.currency,
    subscriptionCode: code || stored.provider_subscription_id || null,
    renewal: !checkout || (checkout.status === 'active' && !!checkout.provider_subscription_id && !transaction.metadata?.type),
  };
}

export async function recordAiSubscriptionTransaction(supabase, input) {
  const reference = safePaymentReference(input.provider, input.providerReference);
  const { data: existing, error: existingError } = await supabase
    .from('ai_subscription_transactions')
    .select('id, participant_id, plan, status')
    .eq('provider', input.provider)
    .eq('provider_reference', reference)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.participant_id !== input.participantId) throw new Error('payment_already_claimed');

  const row = {
    participant_id: input.participantId,
    provider: input.provider,
    provider_reference: reference,
    provider_subscription_id: input.providerSubscriptionId || null,
    product_id: input.productId || null,
    plan: input.plan,
    status: input.status,
    amount_minor: input.amountMinor ?? null,
    currency: input.currency || null,
    current_period_start: input.currentPeriodStart || null,
    current_period_end: input.currentPeriodEnd || null,
    last_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('ai_subscription_transactions')
    .upsert(row, { onConflict: 'provider,provider_reference' });
  if (error) throw error;
  return { existing };
}

export async function applyAiSubscriptionEntitlement(supabase, input) {
  requirePaidPlan(input.plan);
  const { data, error } = await supabase.rpc('sync_ai_provider_subscription', {
    p_input: {
      participant_id: input.participantId,
      provider: input.provider,
      provider_reference: safePaymentReference(input.provider, input.providerReference),
      product_id: input.productId || null,
      plan: input.plan,
      status: input.status,
      current_period_start: input.currentPeriodStart || null,
      current_period_end: input.currentPeriodEnd || null,
      linked_reference: input.linkedReference ? safePaymentReference(input.provider, input.linkedReference) : null,
      retire_linked: Boolean(input.retireLinked),
      pending_product_id: input.pendingProductId || null,
      auto_renewing: input.autoRenewing ?? null,
      observed_at: input.observedAt || new Date().toISOString(),
    },
  });
  if (error) throw error;
  return data;
}

export async function activateVerifiedPaystackSubscription(supabase, participant, transaction) {
  const paystackPlan = await getPaystackAiPaymentQuote(supabase, participant.id, transaction);
  const planId = requirePaidPlan(paystackPlan.planId).id;
  verifyPaystackTransactionDetails(transaction, participant.id, planId, paystackPlan.planCode, paystackPlan, { renewal: paystackPlan.renewal });

  const start = new Date(transaction.paid_at || transaction.transaction_date || Date.now()).toISOString();
  const subscription = transaction.subscription || {};
  const subscriptionCode = paystackPlan.subscriptionCode;
  const end = subscription.next_payment_date || addOneMonth(start);
  await recordAiSubscriptionTransaction(supabase, {
    participantId: participant.id,
    provider: 'paystack',
    providerReference: transaction.reference,
    providerSubscriptionId: subscriptionCode,
    productId: paystackPlan.planCode,
    plan: planId,
    status: 'active',
    amountMinor: Number(transaction.amount),
    currency: transaction.currency,
    currentPeriodStart: start,
    currentPeriodEnd: end,
  });
  await applyAiSubscriptionEntitlement(supabase, {
    participantId: participant.id,
    provider: 'paystack',
    providerReference: subscriptionCode || transaction.reference,
    linkedReference: subscriptionCode ? transaction.reference : null,
    productId: paystackPlan.planCode,
    plan: planId,
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    // Payment chronology, not webhook arrival order, orders Paystack renewals.
    observedAt: start,
  });
  return { plan: AI_PLAN_DEFINITIONS[planId], currentPeriodStart: start, currentPeriodEnd: end };
}

function googleCredentials() {
  const projectId = process.env.GOOGLE_PROJECT_ID?.trim();
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  // Separate server variables take precedence; never mix credential sources.
  if (projectId || clientEmail || privateKey) {
    if (!projectId || !clientEmail || !privateKey?.trim()) throw new Error('google_play_not_configured');
    return {
      type: 'service_account',
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, '\n'),
    };
  }
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('google_play_not_configured');
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch {
    throw new Error('invalid_google_play_credentials');
  }
}

async function getGooglePlayAccessToken() {
  const auth = new GoogleAuth({
    credentials: googleCredentials(),
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new Error('google_play_authentication_failed');
  return token;
}

export async function verifyGooglePlaySubscription(purchaseToken) {
  const token = String(purchaseToken || '');
  if (!token || token.length > 4096) throw new Error('invalid_purchase_token');
  const accessToken = await getGooglePlayAccessToken();
  const observedAt = new Date().toISOString();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || 'google_play_verification_failed');

  return parseGooglePlaySubscription(payload, observedAt);
}

export function parseGooglePlaySubscription(payload, observedAt = new Date().toISOString()) {
  const items = (payload.lineItems || []).filter((item) => planFromGoogleProductId(item.productId));
  if (!items.length) throw new Error('unknown_google_play_product');
  // A deferred downgrade has two line items, in no guaranteed order. The
  // future Pro item has no expiry; the paid Business item keeps its own expiry.
  const ranked = [...items].sort((a, b) => {
    const aLive = new Date(a.expiryTime || 0).getTime() > Date.now();
    const bLive = new Date(b.expiryTime || 0).getTime() > Date.now();
    return Number(bLive) - Number(aLive)
      || (aLive && bLive ? AI_PLAN_DEFINITIONS[planFromGoogleProductId(b.productId)].monthlyCredits
        - AI_PLAN_DEFINITIONS[planFromGoogleProductId(a.productId)].monthlyCredits : 0)
      || new Date(b.expiryTime || 0).getTime() - new Date(a.expiryTime || 0).getTime();
  });
  const item = ranked[0];
  const productId = item.productId;
  const planId = planFromGoogleProductId(productId);
  const currentPeriodEnd = item.expiryTime || null;
  const active = Boolean(ACTIVE_GOOGLE_STATES.has(payload.subscriptionState)
    && currentPeriodEnd && new Date(currentPeriodEnd).getTime() > Date.now());
  const status = active
    ? (payload.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' ? 'cancelled' : 'active')
    : payload.subscriptionState === 'SUBSCRIPTION_STATE_PENDING' ? 'pending'
      : payload.subscriptionState === 'SUBSCRIPTION_STATE_ON_HOLD' ? 'past_due' : 'expired';
  return {
    productId,
    productIds: items.map((line) => line.productId),
    planId,
    status,
    active,
    currentPeriodStart: payload.startTime || null,
    currentPeriodEnd,
    acknowledgementState: payload.acknowledgementState,
    externalAccountId: payload.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
    linkedPurchaseToken: payload.linkedPurchaseToken || null,
    retireLinked: Boolean(payload.startTime && !['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'].includes(payload.subscriptionState)),
    pendingProductId: item.deferredItemReplacement?.productId || null,
    autoRenewing: item.autoRenewingPlan?.autoRenewEnabled ?? null,
    observedAt,
  };
}

export async function acknowledgeGooglePlaySubscription(productId, purchaseToken) {
  const accessToken = await getGooglePlayAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || 'google_play_acknowledgement_failed');
  }
}

export async function syncGooglePlayEntitlement(supabase, participantId, purchaseToken, verified) {
  if (verified.externalAccountId && verified.externalAccountId !== participantId) throw new Error('payment_account_mismatch');
  return applyAiSubscriptionEntitlement(supabase, {
    participantId,
    provider: 'google_play',
    providerReference: purchaseToken,
    productId: verified.productId,
    plan: verified.planId,
    status: verified.status,
    currentPeriodStart: verified.currentPeriodStart,
    currentPeriodEnd: verified.currentPeriodEnd,
    linkedReference: verified.linkedPurchaseToken,
    retireLinked: verified.retireLinked,
    pendingProductId: verified.pendingProductId,
    autoRenewing: verified.autoRenewing,
    observedAt: verified.observedAt,
  });
}

export async function findGooglePlayParticipant(supabase, purchaseToken, verified) {
  const owners = new Set();
  for (const token of [purchaseToken, verified.linkedPurchaseToken].filter(Boolean)) {
    const { data, error } = await supabase.from('ai_provider_subscriptions')
      .select('participant_id').eq('provider', 'google_play')
      .eq('provider_reference', safePaymentReference('google_play', token)).maybeSingle();
    if (error) throw error;
    if (data) owners.add(data.participant_id);
  }
  if (verified.externalAccountId) {
    // Account IDs in new purchases are FlyMadd UUIDs, supplied to Google by the app.
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(verified.externalAccountId)) throw new Error('payment_account_mismatch');
    owners.add(verified.externalAccountId);
  }
  if (owners.size > 1) throw new Error('payment_account_mismatch');
  return [...owners][0] || null;
}

export async function verifyGooglePubSubIdentity(authorizationHeader) {
  const audience = process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
  const expectedEmail = process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL;
  const token = String(authorizationHeader || '').replace(/^Bearer\s+/i, '');
  if (!audience || !expectedEmail || !token) return false;
  try {
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    return Boolean(payload?.email_verified && payload.email === expectedEmail);
  } catch {
    return false;
  }
}

export function verifyPaystackWebhookSignature(body, signature) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha512', secret).update(JSON.stringify(body)).digest('hex');
  const received = String(signature);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
