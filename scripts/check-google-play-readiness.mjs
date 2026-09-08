// Read-only: checks configuration, empty table reads, and a read-only RPC.
// Does not migrate, deploy, publish, make purchases, or print credentials.
import dotenv from 'dotenv';
import { createPrivateKey } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local', quiet: true });

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_PLAY_PUBSUB_AUDIENCE', 'GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL'];
let ready = true;
function result(check, ok, detail = '') {
  if (!ok) ready = false;
  console.log(`${ok ? 'PASS' : 'NEEDS SETUP'}: ${check}${detail ? ` (${detail})` : ''}`);
}
for (const key of required) result(`server variable ${key}`, Boolean(process.env[key]));
let credential;
const separateVariables = ['GOOGLE_PROJECT_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
if (process.env.GOOGLE_PROJECT_ID?.trim() || process.env.GOOGLE_CLIENT_EMAIL?.trim() || process.env.GOOGLE_PRIVATE_KEY) {
  for (const key of separateVariables) result(`server variable ${key}`, Boolean(process.env[key]?.trim()));
  credential = { private_key: process.env.GOOGLE_PRIVATE_KEY };
} else if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
  try {
    credential = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
    result('service-account JSON structure', credential?.type === 'service_account' && !!credential.client_email && !!credential.private_key);
  } catch { result('service-account JSON structure', false, 'invalid JSON'); }
} else {
  result('Google Play credentials', false, 'set all three GOOGLE_* variables or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
}
if (credential?.private_key) {
  try {
    const key = createPrivateKey(credential.private_key.replace(/\\n/g, '\n'));
    result('service-account private key', key.asymmetricKeyType === 'rsa');
  } catch { result('service-account private key', false, 'replace the placeholder with a valid RSA private key'); }
}
if (process.argv.includes('--remote')) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    for (const [table, columns] of [
      ['ai_subscriptions', 'participant_id,plan'],
      ['ai_subscription_transactions', 'participant_id,provider_reference'],
      ['ai_provider_subscriptions', 'participant_id,linked_reference,replaced_by_reference,observed_at,pending_product_id'],
    ]) {
      const { error } = await db.from(table).select(columns).limit(0);
      result(`database ${table}`, !error, error ? `error ${error.code || 'connection'}` : 'no account data read');
    }
    const { error } = await db.rpc('get_ai_subscription_entitlement', { p_participant_id: '00000000-0000-0000-0000-000000000000' });
    result('database entitlement function', !error, error ? `error ${error.code || 'connection'}` : 'read-only probe');
  }
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online').replace(/\/$/, '');
  for (const endpoint of ['google-play', 'google-play-notification']) {
    try {
      const response = await fetch(`${origin}/api/onedream/ai-subscription/${endpoint}`, { signal: AbortSignal.timeout(15000) });
      result(`deployed ${endpoint} route`, response.status === 405, `GET status ${response.status}; implementation version still needs authenticated verification`);
    } catch { result(`deployed ${endpoint} route`, false, 'connection failed'); }
  }
}
console.log('MANUAL: verify Play product/base-plan activation, service-account permissions, RTDN test delivery, and license-tester purchases.');
console.log('MANUAL: deploy the reviewed backend and upload a newly built AAB to internal/closed testing.');
process.exitCode = ready ? 0 : 1;
