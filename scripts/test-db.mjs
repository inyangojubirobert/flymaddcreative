import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get directory of this script
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
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          process.env[key] = value;
        }
      }
    });
    console.log('✅ Loaded .env.local');
  } catch (err) {
    console.warn('⚠️ Could not load .env.local:', err.message);
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

console.log('\n🔍 SUPABASE CONNECTION TEST (using fetch)');
console.log('━'.repeat(50));

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables!');
  console.error('   SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('   SUPABASE_ANON_KEY:', supabaseKey ? '✓' : '✗');
  process.exit(0); // Exit gracefully so npm run dev continues
}

console.log('📍 URL:', supabaseUrl);
console.log('🔑 Key:', supabaseKey.substring(0, 30) + '...\n');

// Helper to make Supabase REST API calls
async function supabaseQuery(table, method = 'GET', body = null, filters = '') {
  const url = `${supabaseUrl}/rest/v1/${table}${filters}`;
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : undefined
  };
  
  // Remove undefined headers
  Object.keys(headers).forEach(k => headers[k] === undefined && delete headers[k]);

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  
  // Handle empty responses (like DELETE)
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  
  return { 
    data, 
    error: response.ok ? null : { message: data?.message || text || 'Unknown error', code: data?.code },
    status: response.status 
  };
}

async function runTests() {
  // Test 1: SELECT
  console.log('1️⃣  Testing SELECT on participants...');
  const { data: rows, error: selectErr } = await supabaseQuery('participants', 'GET', null, '?select=id,name,username,user_code&limit=3');

  if (selectErr) {
    console.error('   ❌ FAILED:', selectErr.message);
    console.log('   💡 Check RLS policy: CREATE POLICY "public_select" ON participants FOR SELECT USING (true);');
  } else {
    console.log('   ✅ SUCCESS - Found', Array.isArray(rows) ? rows.length : 0, 'participants');
  }

  // Test 2: INSERT
  console.log('\n2️⃣  Testing INSERT on participants...');
  const testUsername = `npmtest_${Date.now()}`;
  const { data: insertData, error: insertErr } = await supabaseQuery('participants', 'POST', {
    name: 'NPM Test',
    email: `${testUsername}@test.com`,
    username: testUsername
  }, '?select=id,name,username,user_code');

  if (insertErr) {
    console.error('   ❌ FAILED:', insertErr.message);
    console.log('   💡 Check RLS policy: CREATE POLICY "public_insert" ON participants FOR INSERT WITH CHECK (true);');
  } else {
    const newRow = Array.isArray(insertData) ? insertData[0] : insertData;
    console.log('   ✅ SUCCESS - Created:');
    console.log('      ID:', newRow?.id);
    console.log('      Username:', newRow?.username);
    console.log('      User Code:', newRow?.user_code || '⚠️ NULL (trigger missing?)');

    // Test 3: Check referral_links
    if (newRow?.id) {
      console.log('\n3️⃣  Testing referral_links trigger...');
      
      // Wait for trigger
      await new Promise(r => setTimeout(r, 500));
      
      const { data: linkData, error: linkErr } = await supabaseQuery(
        'referral_links', 'GET', null, 
        `?participant_id=eq.${newRow.id}&select=user_vote_link`
      );

      if (linkErr || !linkData?.length) {
        console.warn('   ⚠️ Referral link not found (trigger may not exist)');
      } else {
        console.log('   ✅ SUCCESS - Vote link:', linkData[0]?.user_vote_link);
      }

      // Cleanup
      console.log('\n🧹 Cleaning up test data...');
      await supabaseQuery('referral_links', 'DELETE', null, `?participant_id=eq.${newRow.id}`);
      await supabaseQuery('participants', 'DELETE', null, `?id=eq.${newRow.id}`);
      console.log('   ✅ Test data deleted');
    }
  }

  console.log('\n' + '━'.repeat(50));
  console.log('🏁 Test complete!\n');
}

runTests().catch(err => {
  console.error('❌ Test error:', err.message);
}).finally(() => {
  process.exit(0); // Always exit gracefully
});
