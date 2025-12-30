import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Load .env.local manually
function loadEnv() {
  try {
    const envPath = join(rootDir, '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          process.env[trimmed.substring(0, eqIndex).trim()] = trimmed.substring(eqIndex + 1).trim();
        }
      }
    });
    console.log('✅ Loaded .env.local');
  } catch (err) {
    console.warn('⚠️ Could not load .env.local:', err.message);
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('\n🔍 SUPABASE CONNECTION TEST');
console.log('━'.repeat(50));

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables!');
  process.exit(0);
}

console.log('📍 URL:', supabaseUrl);
console.log('🔑 Key:', supabaseKey.substring(0, 30) + '...\n');

// Create Supabase client (same as src/backend/supabase.js)
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  // Test 1: SELECT
  console.log('1️⃣  Testing SELECT on participants...');
  const { data: rows, error: selectErr } = await supabase
    .from('participants')
    .select('id, username')
    .limit(5);

  if (selectErr) {
    console.error('   ❌ FAILED:', selectErr.message);
    process.exit(0);
  }
  console.log('   ✅ SUCCESS - Found', rows?.length || 0, 'participants');

  // Test 2: INSERT
  console.log('\n2️⃣  Testing INSERT on participants...');
  const testUsername = `_dbtest_${Date.now()}`;
  const { data: newRow, error: insertErr } = await supabase
    .from('participants')
    .insert({ name: 'DB Test', email: `${testUsername}@test.local`, username: testUsername })
    .select('id, username, user_code')
    .single();

  if (insertErr) {
    console.error('   ❌ FAILED:', insertErr.message);
    process.exit(0);
  }
  console.log('   ✅ SUCCESS - User Code:', newRow?.user_code || 'NULL');

  // Cleanup
  if (newRow?.id) {
    console.log('\n🧹 Cleaning up...');
    await supabase.from('referral_links').delete().eq('participant_id', newRow.id);
    await supabase.from('participants').delete().eq('id', newRow.id);
    console.log('   ✅ Deleted test user');
  }

  console.log('\n' + '━'.repeat(50));
  console.log('✅ Database connection verified!\n');
}

runTests().catch(err => console.error('❌ Error:', err.message)).finally(() => process.exit(0));
