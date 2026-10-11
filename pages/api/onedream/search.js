import { createClient } from '@supabase/supabase-js';
import { parseSearchOptions, searchMarketplace } from '../../../lib/catalogueSearch';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.query.q !== undefined && typeof req.query.q !== 'string') {
    return res.status(400).json({ error: 'Search must be a single string' });
  }
  let options;
  try {
    options = parseSearchOptions(req.query);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    return res.status(200).json(await searchMarketplace(supabase, req.query.q, options));
  } catch {
    return res.status(503).json({ error: 'Search is temporarily unavailable. Please try again.' });
  }
}
