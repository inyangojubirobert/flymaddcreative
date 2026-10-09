// Ownership-checked writes for catalogue_items. Replaces the pattern where
// public/js/supabase-config.js's saveCatalogueItem()/deleteCatalogueItem()
// wrote directly to Supabase from the browser with the anon key and NO
// ownership check at all - seller_username came straight from the
// client-supplied object, so any caller could create/edit/delete any
// seller's listings. Reads stay exactly as they were (catalogue browsing is
// intentionally public, no auth needed) - only writes move here.
//
// Mirrors the ownership-check pattern already established in
// pages/api/catalogue/order-action.js and lib/participantAuth.js.

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import { validateListingFields } from '../../../lib/catalogueListingValidation';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Only validated listing fields are ever written from client input - id,
// seller_username, created_at, updated_at are always server-controlled.

async function assertCategory(categoryId, res) {
  let { data, error } = await supabase
    .from('catalogue_categories')
    .select('id, is_active, is_selectable')
    .eq('id', categoryId)
    .maybeSingle();
  if (error && /is_selectable/.test(error.message || '')) {
    ({ data, error } = await supabase
      .from('catalogue_categories')
      .select('id, is_active')
      .eq('id', categoryId)
      .maybeSingle());
  }
  if (error || !data || data.is_active === false) {
    res.status(400).json({ error: 'Choose a category from the shop list.' });
    return true;
  }
  if (data.is_selectable === false) {
    res.status(400).json({ error: 'Choose a specific category. Departments and broad buckets cannot be attached to a product.' });
    return true;
  }
  const { count, error: childError } = await supabase
    .from('catalogue_categories')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', categoryId);
  if (childError || (count || 0) > 0) {
    res.status(400).json({ error: 'Choose a category inside a department.' });
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return; // response already sent

  try {
    if (req.method === 'POST') {
      const { payload, error: validationError } = validateListingFields(req.body, { isCreate: true });
      if (validationError) return res.status(400).json({ error: validationError });
      const categoryError = await assertCategory(payload.category_id, res);
      if (categoryError) return;

      const { data, error } = await supabase
        .from('catalogue_items')
        .insert({
          ...payload,
          seller_username: participant.username, // never trust a client-supplied seller_username
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Catalogue item create error:', error);
        return res.status(500).json({ error: 'Failed to create item' });
      }
      return res.status(201).json(data);
    }

    if (req.method === 'PATCH') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { data: existing, error: lookupError } = await supabase
        .from('catalogue_items')
        .select('seller_username, status')
        .eq('id', id)
        .single();

      if (lookupError || !existing || existing.status === 'deleted') {
        return res.status(404).json({ error: 'Item not found' });
      }
      if (existing.seller_username !== participant.username) {
        return res.status(403).json({ error: 'Not authorized for this item' });
      }

      const { payload, error: validationError } = validateListingFields(req.body, { isCreate: false });
      if (validationError) return res.status(400).json({ error: validationError });
      if (payload.category_id) {
        const categoryError = await assertCategory(payload.category_id, res);
        if (categoryError) return;
      }
      const { data, error } = await supabase
        .from('catalogue_items')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('seller_username', participant.username)
        .neq('status', 'deleted')
        .select()
        .single();

      if (error) {
        console.error('Catalogue item update error:', error);
        return res.status(500).json({ error: 'Failed to update item' });
      }
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { data: existing, error: lookupError } = await supabase
        .from('catalogue_items')
        .select('seller_username')
        .eq('id', id)
        .single();

      if (lookupError || !existing) {
        return res.status(404).json({ error: 'Item not found' });
      }
      if (existing.seller_username !== participant.username) {
        return res.status(403).json({ error: 'Not authorized for this item' });
      }

      const { error } = await supabase
        .from('catalogue_items')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('seller_username', participant.username);

      if (error) {
        console.error('Catalogue item delete error:', error);
        return res.status(500).json({ error: 'Failed to delete item' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('catalogue/items error:', error);
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}
