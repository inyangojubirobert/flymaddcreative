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

async function supabaseQuery(table, method, filters = '') {
  const url = `${supabaseUrl}/rest/v1/${table}${filters}`;
  const response = await fetch(url, {
    method,
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    }
  });
  const text = await response.text();
  return { ok: response.ok, data: text ? JSON.parse(text) : null };
}

async function cleanup() {
  console.log('\n🧹 CLEANING UP TEST DATA');
  console.log('━'.repeat(40));

  // First, find all test participants
  console.log('\n1️⃣  Finding test participants...');
  const { data: testParticipants } = await supabaseQuery(
    'participants', 
    'GET', 
    '?select=id,username&or=(username.like.npmtest_*,username.like.test_*)'
  );

  if (!testParticipants || testParticipants.length === 0) {
    console.log('   ✅ No test data found');
    return;
  }

  console.log(`   Found ${testParticipants.length} test participants:`);
  testParticipants.forEach(p => console.log(`   - ${p.username} (${p.id})`));

  // Delete each one by ID
  console.log('\n2️⃣  Deleting test data...');
  
  for (const participant of testParticipants) {
    // Delete referral_link first
    await supabaseQuery('referral_links', 'DELETE', `?participant_id=eq.${participant.id}`);
    // Delete participant
    await supabaseQuery('participants', 'DELETE', `?id=eq.${participant.id}`);
    console.log(`   ✅ Deleted: ${participant.username}`);
  }

  console.log('\n' + '━'.repeat(40));
  console.log('🏁 Cleanup complete!\n');
}

cleanup().catch(console.error);
