// Creates and activates one-time products in Play Console through the
// Android Publisher API. Skips products that already exist. Regional prices
// are converted by Google from the USD price; the US price is kept exact.
//
//   node scripts/create-google-play-products.mjs --dry-run
//   node scripts/create-google-play-products.mjs
//
// The service account needs Play Console permission "Manage store presence".
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
dotenv.config({ path: '.env.local', quiet: true });

const PRODUCTS = [
  // Digital-product price tiers (digital_price_tiers): each unlocks one e-book,
  // audio or video item at that price.
  ...['0.99', '1.99', '2.99', '3.99', '4.99', '5.99', '6.99', '7.99', '8.99', '9.99', '12.99', '14.99', '19.99', '24.99', '29.99', '39.99', '49.99'].map((usd) => ({
    id: `onedream_digital_${usd.replace('.', '').padStart(4, '0')}`,
    usd,
    title: `Digital item — $${usd}`,
    description: 'Unlocks one digital product (e-book, audio or video) in One Dream, sold by its creator at this price.',
    withdrawal: 'WITHDRAWAL_RIGHT_DIGITAL_CONTENT',
  })),
];
const REGIONS_VERSION = '2026/01';
const dryRun = process.argv.includes('--dry-run');
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
    const error = new Error(`${method} ${path.split("?")[0]}: ${data?.error?.message || `HTTP ${response.status}`}`);
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
    return (await google(`/oneTimeProducts:batchGet?productIds=${encodeURIComponent(id)}`)).oneTimeProducts?.[0] || null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

const activate = (id) => google(`/oneTimeProducts/${encodeURIComponent(id)}/purchaseOptions:batchUpdateStates`, 'POST', {
  requests: [{ activatePurchaseOptionRequest: { packageName, productId: id, purchaseOptionId: 'buy' } }],
});

let failed = false;
for (const product of PRODUCTS) {
  try {
    const current = await existing(product.id);
    if (current) {
      const buy = current.purchaseOptions?.find((o) => o.purchaseOptionId === 'buy');
      if (!buy || buy.state === 'ACTIVE' || dryRun) { console.log(`SKIP ${product.id}: already exists${buy ? ` (${buy.state})` : ''}`); continue; }
      await activate(product.id);
      console.log(`ACTIVATED ${product.id}: was ${buy.state}`);
      continue;
    }
    const price = money(product.usd);
    const converted = await google('/pricing:convertRegionPrices', 'POST', { price });
    const regional = Object.values(converted.convertedRegionPrices || {}).map((c) => ({
      regionCode: c.regionCode,
      price: c.regionCode === 'US' ? price : c.price,
      availability: 'AVAILABLE',
    }));
    const body = {
      packageName,
      productId: product.id,
      listings: [{ languageCode: 'en-US', title: product.title, description: product.description }],
      purchaseOptions: [{
        purchaseOptionId: 'buy',
        buyOption: { legacyCompatible: true, multiQuantityEnabled: false },
        regionalPricingAndAvailabilityConfigs: regional,
        newRegionsConfig: {
          usdPrice: converted.convertedOtherRegionsPrice?.usdPrice || price,
          eurPrice: converted.convertedOtherRegionsPrice?.eurPrice,
          availability: 'AVAILABLE',
        },
        taxAndComplianceSettings: { withdrawalRightType: product.withdrawal || 'WITHDRAWAL_RIGHT_SERVICE' },
      }],
    };
    if (dryRun) { console.log(`DRY RUN ${product.id}: $${product.usd}, ${regional.length} regions`); continue; }
    await google(`/onetimeproducts/${encodeURIComponent(product.id)}?allowMissing=true&updateMask=listings,purchaseOptions&regionsVersion.version=${REGIONS_VERSION}`, 'PATCH', body);
    await activate(product.id);
    console.log(`CREATED ${product.id}: $${product.usd}, ${regional.length} regions, active`);
  } catch (error) {
    failed = true;
    console.log(`FAILED ${product.id}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
