import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testInsertPolicy() {
  const testEmail = `policytest_${Date.now()}@test.local`;
  const { data, error } = await supabase
    .from('participants')
    .insert({
      name: 'Policy Test',
      email: testEmail,
      username: `policytest_${Date.now()}`
    })
    .select('id, email, username');

  if (error) {
    console.error('❌ Insert policy failed:', error.message);
    process.exit(1);
  } else {
    console.log('✅ Insert policy OK:', data);
    // Cleanup
    if (data && data[0]?.id) {
      await supabase.from('participants').delete().eq('id', data[0].id);
      console.log('🧹 Cleaned up test row');
    }
    process.exit(0);
  }
}

testInsertPolicy();
