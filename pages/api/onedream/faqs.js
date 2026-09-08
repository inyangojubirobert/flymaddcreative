import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const FALLBACK_FAQS = [
  {
    id: 'catalogue-mobile-guide',
    category: 'Catalogue',
    question: 'How do I build a catalogue in the mobile app?',
    answer: 'Sign in, open Profile, choose My Listings, then select + New Listing. Add a title, description, USD price, artwork image URL, and set the listing to Live before saving it.',
    sort_order: 20,
  },
  {
    id: 'support-guide',
    category: 'Support',
    question: 'How do I contact Support or Bascardo Token AI?',
    answer: 'Open Profile and choose Support Messages. Send a message for FlyMadd Support or write your question and select Ask AI for project and app guidance.',
    sort_order: 80,
  },
];

// The public app reads this through an authenticated API route rather than
// directly from Supabase. That keeps the same approved source available to
// Bascardo Token AI without exposing database access to a client bundle.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const { data, error } = await supabase
      .from('project_faqs')
      .select('id, category, question, answer, sort_order')
      .eq('is_published', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      // Keep the native help screen useful during a staggered deployment,
      // e.g. when an APK reaches users before its Supabase migration runs.
      console.error('Project FAQ table unavailable:', error.message);
      return res.status(200).json({ faqs: FALLBACK_FAQS, fallback: true });
    }

    return res.status(200).json({ faqs: data || [] });
  } catch (error) {
    console.error('Project FAQ fetch error:', error);
    return res.status(500).json({ error: 'Unable to load help topics' });
  }
}
