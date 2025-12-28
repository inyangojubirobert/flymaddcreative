import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Load .env.local
function loadEnv() {
  try {
    const envPath = join(rootDir, '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          process.env[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim();
        }
      }
    });
  } catch (err) {
    console.warn('Could not load .env.local');
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

async function supabaseDelete(table, filters) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${filters}`, {
    method: 'DELETE',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    }
  });
  return response.ok;
}

async function cleanup() {
  console.log('\n🧹 CLEANING UP TEST DATA');
  console.log('━'.repeat(40));

  // Delete test referral_links first (foreign key)
  console.log('Deleting test referral_links...');
  await supabaseDelete('referral_links', '?username=like.npmtest_%');
  await supabaseDelete('referral_links', '?username=like.test_%');

  // Delete test participants
  console.log('Deleting test participants...');
  await supabaseDelete('participants', '?username=like.npmtest_%');
  await supabaseDelete('participants', '?username=like.test_%');

  console.log('✅ Cleanup complete!\n');
}

cleanup().catch(console.error);
