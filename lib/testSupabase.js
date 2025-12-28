import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export async function testSupabaseConnection() {
  console.log('\n🔍 Testing Supabase Connection...');
  console.log('━'.repeat(50));

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials!');
    console.error('   SUPABASE_URL:', supabaseUrl ? '✓ Set' : '✗ Missing');
    console.error('   SUPABASE_ANON_KEY:', supabaseKey ? '✓ Set' : '✗ Missing');
    return false;
  }

  console.log('📍 URL:', supabaseUrl);
  console.log('🔑 Key:', supabaseKey.substring(0, 20) + '...');

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Test SELECT on participants
    const { data: selectData, error: selectError } = await supabase
      .from('participants')
      .select('id')
      .limit(1);

    if (selectError) {
      console.error('❌ SELECT test failed:', selectError.message);
      console.error('   Code:', selectError.code);
      if (selectError.code === '42501') {
        console.error('   💡 Fix: Add RLS policy for SELECT on participants table');
      }
      return false;
    }
    console.log('✅ SELECT works - Found', selectData?.length || 0, 'rows');

    // Test INSERT capability (dry run - we'll rollback)
    const testEmail = `test_${Date.now()}@test.com`;
    const { data: insertData, error: insertError } = await supabase
      .from('participants')
      .insert({
        name: 'Test User',
        email: testEmail,
        username: `test_${Date.now()}`
      })
      .select('id, user_code')
      .single();

    if (insertError) {
      console.error('❌ INSERT test failed:', insertError.message);
      console.error('   Code:', insertError.code);
      if (insertError.code === '42501') {
        console.error('   💡 Fix: Add RLS policy for INSERT on participants table');
      }
      return false;
    }
    console.log('✅ INSERT works - Created test participant');
    console.log('   ID:', insertData.id);
    console.log('   User Code:', insertData.user_code || '(trigger may not exist)');

    // Check if referral_link was created by trigger
    const { data: linkData, error: linkError } = await supabase
      .from('referral_links')
      .select('user_vote_link')
      .eq('participant_id', insertData.id)
      .single();

    if (linkError) {
      console.warn('⚠️  Referral link trigger may not be working:', linkError.message);
    } else {
      console.log('✅ Referral link trigger works');
      console.log('   Vote Link:', linkData.user_vote_link);
    }

    // Cleanup - delete test participant
    const { error: deleteError } = await supabase
      .from('participants')
      .delete()
      .eq('id', insertData.id);

    if (deleteError) {
      console.warn('⚠️  Could not cleanup test data:', deleteError.message);
    } else {
      console.log('🧹 Cleaned up test data');
    }

    console.log('━'.repeat(50));
    console.log('✅ All Supabase tests passed!\n');
    return true;

  } catch (error) {
    console.error('❌ Connection test exception:', error);
    return false;
  }
}

// Run if called directly
if (process.argv[1]?.includes('testSupabase')) {
  testSupabaseConnection().then(success => {
    process.exit(success ? 0 : 1);
  });
}
