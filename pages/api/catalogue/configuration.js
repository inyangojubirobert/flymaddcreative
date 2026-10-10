import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : null;
  const listingType = req.query.listing_type;
  if (listingType !== 'product' && listingType !== 'service') {
    return res.status(400).json({ error: 'Choose product or service.' });
  }

  try {
    const [unitsResult, modelsResult, attributesResult] = await Promise.all([
      supabase.from('catalogue_units')
        .select('key, label, applies_to, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('catalogue_pricing_models')
        .select('key, label, applies_to, requires_unit, requires_price, checkout_compatible, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('catalogue_attribute_definitions')
        .select('id, category_id, listing_type, key, label, input_type, options, unit, is_required, allow_other, min_number, max_number, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
    ]);

    const failed = [unitsResult, modelsResult, attributesResult].find((result) => result.error);
    if (failed) {
      console.error('Catalogue listing configuration lookup error:', failed.error);
      return res.status(500).json({ error: 'Listing configuration is unavailable. Try again after the catalogue setup is complete.' });
    }

    const units = (unitsResult.data || []).filter((unit) => unit.applies_to.includes(listingType));
    const pricing_models = (modelsResult.data || []).filter((model) => model.applies_to.includes(listingType));
    const attributes = (attributesResult.data || []).filter((attribute) =>
      (!attribute.category_id || attribute.category_id === categoryId)
      && (!attribute.listing_type || attribute.listing_type === listingType));

    return res.status(200).json({ units, pricing_models, attributes });
  } catch (error) {
    console.error('Catalogue configuration API error:', error);
    return res.status(500).json({ error: 'Failed to load listing configuration.' });
  }
}
