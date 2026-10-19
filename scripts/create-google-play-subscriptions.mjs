// Creates and activates the creator subscription products in Play Console
// through the Android Publisher API: one auto-renewing monthly base plan
// ("monthly"), no trial or intro offer, configured like the live AI
// subscription. Skips subscriptions that exist with an active base plan and
// activates a base plan left in draft. Regional prices are converted by
// Google from the USD price; the US price is kept exact.
//
//   node scripts/create-google-play-subscriptions.mjs --dry-run
//   node scripts/create-google-play-subscriptions.mjs [--only onedream_creator_0199_s1]
//
// The service account needs Play Console permission "Manage store presence".
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
dotenv.config({ path: '.env.local', quiet: true });

// digital_sub_products: 6 slots per monthly price (one live subscription per
// product per user, so each slot lets a user follow one more creator).
const PRICES = ['1.99', '2.99', '4.99', '7.99', '9.99', '19.99'];
const SUBSCRIPTIONS = PRICES.flatMap((usd) => ['s1', 's2', 's3', 's4', 's5', 's6'].map((slot) => ({
  id: `onedream_creator_${usd.replace('.', '').padStart(4, '0')}_${slot}`,
  usd,
  title: `Creator subscription — $${usd}/month`,
  description: "Monthly access to one creator's digital products in One Dream.",
})));
const BASE_PLAN_ID = 'monthly';
const REGIONS_VERSION = '2026/01';
const dryRun = process.argv.includes('--dry-run');
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex > -1 ? process.argv[onlyIndex + 1] : null;
const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;

const auth = new GoogleAuth({
  credentials: {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

async function google(path, method = 'GET', body) {
  const { token } = await (await auth.getClient()).getAccessToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${method} ${path.split('?')[0]}: ${data?.error?.message || `HTTP ${response.status}`}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const money = (usd) => {
  const [units, cents = '0'] = usd.split('.');
  return { currencyCode: 'USD', units, nanos: Number(cents.padEnd(2, '0')) * 1e7 };
};

async function existing(id) {
  try {
    return await google(`/subscriptions/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

const activate = (id) => google(`/subscriptions/${encodeURIComponent(id)}/basePlans/${BASE_PLAN_ID}:activate`, 'POST', {
  packageName, productId: id, basePlanId: BASE_PLAN_ID,
});

let failed = false;
for (const sub of SUBSCRIPTIONS.filter((s) => !only || s.id === only)) {
  try {
    const current = await existing(sub.id);
    if (current) {
      const plan = (current.basePlans || []).find((p) => p.basePlanId === BASE_PLAN_ID);
      if (!plan || plan.state === 'ACTIVE' || dryRun) { console.log(`SKIP ${sub.id}: already exists${plan ? ` (${plan.state})` : ' (no "monthly" base plan - fix by hand)'}`); continue; }
      await activate(sub.id);
      console.log(`ACTIVATED ${sub.id}: was ${plan.state}`);
      continue;
    }
    const price = money(sub.usd);
    const converted = await google('/pricing:convertRegionPrices', 'POST', { price });
    const regionalConfigs = Object.values(converted.convertedRegionPrices || {}).map((c) => ({
      regionCode: c.regionCode,
      price: c.regionCode === 'US' ? price : c.price,
      newSubscriberAvailability: true,
    }));
    const body = {
      packageName,
      productId: sub.id,
      listings: [{ languageCode: 'en-US', title: sub.title, description: sub.description }],
      basePlans: [{
        basePlanId: BASE_PLAN_ID,
        autoRenewingBasePlanType: {
          billingPeriodDuration: 'P1M',
          gracePeriodDuration: 'P7D',
          resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE',
          prorationMode: 'SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE',
          legacyCompatible: true,
        },
        regionalConfigs,
        otherRegionsConfig: {
          usdPrice: converted.convertedOtherRegionsPrice?.usdPrice || price,
          eurPrice: converted.convertedOtherRegionsPrice?.eurPrice,
          newSubscriberAvailability: true,
        },
      }],
      taxAndComplianceSettings: { eeaWithdrawalRightType: 'WITHDRAWAL_RIGHT_DIGITAL_CONTENT' },
    };
    if (dryRun) { console.log(`DRY RUN ${sub.id}: $${sub.usd}/month, ${regionalConfigs.length} regions`); continue; }
    await google(`/subscriptions?productId=${encodeURIComponent(sub.id)}&regionsVersion.version=${REGIONS_VERSION}`, 'POST', body);
    await activate(sub.id);
    console.log(`CREATED ${sub.id}: $${sub.usd}/month, ${regionalConfigs.length} regions, active`);
  } catch (error) {
    failed = true;
    console.log(`FAILED ${sub.id}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
