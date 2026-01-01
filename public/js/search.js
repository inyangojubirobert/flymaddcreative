// Remove all HTML from this file. Only JavaScript code should be here.

// Search logic for Find Participant page
let foundParticipant = null;

document.addEventListener('DOMContentLoaded', async function() {
    // Optionally initialize Supabase if needed for other features

    // Ensure meta tag is present before initializing Supabase
    const meta = document.querySelector('meta[name="supabase-config"]');
    if (!meta) {
        console.error('❌ Supabase meta config missing in HTML. Please add the <meta name="supabase-config" ...> tag to your <head>.');