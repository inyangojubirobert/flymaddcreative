// Turns on multi-quantity purchasing (buyer picks how many packs in Google's
// purchase sheet) for the existing Dream Coin products. The backend credits
// Google's verified quantity x coins per pack.
//
//   node scripts/enable-dream-coin-multi-quantity.mjs --dry-run
//   node scripts/enable-dream-coin-multi-quantity.mjs           enable
//   node scripts/enable-dream-coin-multi-quantity.mjs --disable turn it off again
//
// Reads each product, flips buyOption.multiQuantityEnabled on its "buy"
// purchase option and writes the purchase options back unchanged otherwise.
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
dotenv.config({ path: '.env.local', quiet: true });

const IDS = ['100', '250', '600', '1300', '2800', '7500', '16000'].map((c) => `dream_coins_${c}`);
const REGIONS_VERSION = '2026/01';
const dryRun = process.argv.includes('--dry-run');
const enable = !process.argv.includes('--disable');
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
  if (!response.ok) throw new Error(`${method} ${path.split('?')[0]}: ${data?.error?.message || `HTTP ${response.status}`}`);
  return data;
}

let failed = false;
for (const id of IDS) {
  try {
    const product = (await google(`/oneTimeProducts:batchGet?productIds=${encodeURIComponent(id)}`)).oneTimeProducts?.[0];
    if (!product) { console.log(`MISSING ${id}`); failed = true; continue; }
    const buy = product.purchaseOptions?.find((o) => o.purchaseOptionId === 'buy');
    if (!buy?.buyOption) { console.log(`SKIP ${id}: no buy option`); continue; }
    if (Boolean(buy.buyOption.multiQuantityEnabled) === enable) { console.log(`OK ${id}: multi-quantity already ${enable ? 'on' : 'off'} (${buy.state})`); continue; }
    if (dryRun) { console.log(`DRY RUN ${id}: would turn multi-quantity ${enable ? 'on' : 'off'}`); continue; }
    const purchaseOptions = product.purchaseOptions.map((o) => {
      const { state, ...rest } = o; // state is output-only
      return o.purchaseOptionId === 'buy' ? { ...rest, buyOption: { ...rest.buyOption, multiQuantityEnabled: enable } } : rest;
    });
    await google(`/onetimeproducts/${encodeURIComponent(id)}?updateMask=purchaseOptions&regionsVersion.version=${REGIONS_VERSION}`, 'PATCH',
      { packageName, productId: id, listings: product.listings, purchaseOptions });
    const after = (await google(`/oneTimeProducts:batchGet?productIds=${encodeURIComponent(id)}`)).oneTimeProducts?.[0];
    const afterBuy = after?.purchaseOptions?.find((o) => o.purchaseOptionId === 'buy');
    console.log(`UPDATED ${id}: multi-quantity ${afterBuy?.buyOption?.multiQuantityEnabled ? 'on' : 'off'}, state ${afterBuy?.state}`);
  } catch (error) {
    failed = true;
    console.log(`FAILED ${id}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
