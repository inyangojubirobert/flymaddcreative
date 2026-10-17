// Creates the seven Dream Coin consumable products in Play Console through the
// Android Publisher API (same approach as create-google-play-products.mjs,
// which is left untouched). Skips products that already exist.
//
//   node scripts/create-dream-coin-products.mjs --dry-run
//   node scripts/create-dream-coin-products.mjs                    create, INACTIVE, single quantity
//   node scripts/create-dream-coin-products.mjs --activate         create/activate the "buy" option
//   node scripts/create-dream-coin-products.mjs --multi-quantity   allow quantity selection (new products only)
//
// Do not --activate before the Google Play policy review is signed off
// (docs/DREAM_COINS_POLICY_READINESS.md), and do not use --multi-quantity until
// a single-unit and a multi-unit license-tester purchase have both credited
// correctly on the deployed backend. Coin sales also need DREAM_COINS_ENABLED=true.
//
// The service account needs Play Console permission "Manage store presence".
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
dotenv.config({ path: '.env.local', quiet: true });

const PACKS = [['100', '0.99'], ['250', '1.99'], ['600', '4.99'], ['1300', '9.99'], ['2800', '19.99'], ['7500', '49.99'], ['16000', '99.99']];
const PRODUCTS = PACKS.map(([coins, usd]) => ({
  id: `dream_coins_${coins}`,
  usd,
  title: `${Number(coins).toLocaleString('en-US')} Dream Coins`,
  description: `${Number(coins).toLocaleString('en-US')} Dream Coins for sending virtual appreciation gifts in One Dream. No cash value; not withdrawable or transferable.`,
}));
const REGIONS_VERSION = '2026/01';
const dryRun = process.argv.includes('--dry-run');
const activateNow = process.argv.includes('--activate');
const multiQuantity = process.argv.includes('--multi-quantity');
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
      if (!activateNow || !buy || buy.state === 'ACTIVE' || dryRun) { console.log(`SKIP ${product.id}: already exists${buy ? ` (${buy.state})` : ''}`); continue; }
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
        buyOption: { legacyCompatible: true, multiQuantityEnabled: multiQuantity },
        regionalPricingAndAvailabilityConfigs: regional,
        newRegionsConfig: {
          usdPrice: converted.convertedOtherRegionsPrice?.usdPrice || price,
          eurPrice: converted.convertedOtherRegionsPrice?.eurPrice,
          availability: 'AVAILABLE',
        },
        taxAndComplianceSettings: { withdrawalRightType: 'WITHDRAWAL_RIGHT_DIGITAL_CONTENT' },
      }],
    };
    if (dryRun) { console.log(`DRY RUN ${product.id}: $${product.usd}, ${regional.length} regions, multi-quantity ${multiQuantity ? 'on' : 'off'}`); continue; }
    await google(`/onetimeproducts/${encodeURIComponent(product.id)}?allowMissing=true&updateMask=listings,purchaseOptions&regionsVersion.version=${REGIONS_VERSION}`, 'PATCH', body);
    if (activateNow) await activate(product.id);
    console.log(`CREATED ${product.id}: $${product.usd}, ${regional.length} regions, ${activateNow ? 'active' : 'inactive'}, multi-quantity ${multiQuantity ? 'on' : 'off'}`);
  } catch (error) {
    failed = true;
    console.log(`FAILED ${product.id}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
