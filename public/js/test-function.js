// Simple test function to verify JS loading and Supabase config

(function() {
    console.log('✅ test-function.js loaded');
    if (typeof window.initSupabaseFromMeta === 'function') {
        const result = window.initSupabaseFromMeta();
        console.log('Supabase init result:', result);
    } else {
        console.warn('window.initSupabaseFromMeta is not defined');
    }
})();
