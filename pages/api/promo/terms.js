// Public: the current One Dream Storefront Promotion terms (website page and app).

import { consentSentence, currentTerms } from '../../../lib/storefrontPromo';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const terms = await currentTerms();
    if (!terms) return res.status(404).json({ error: 'The programme is not open yet' });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      version: terms.version,
      title: terms.title,
      body: terms.body,
      sha256: terms.body_sha256,
      min_active_listings: terms.min_active_listings,
      max_ad_spend_usd: Number(terms.max_ad_spend_usd),
      programme_budget_usd: Number(terms.programme_budget_usd),
      consent: consentSentence(terms.version),
      published_at: terms.published_at,
    });
  } catch (error) {
    console.error('promo/terms error:', error.message || error);
    return res.status(500).json({ error: 'Could not load the programme terms' });
  }
}
