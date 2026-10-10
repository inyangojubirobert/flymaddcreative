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
import { configuredAttributesError, configuredUnitError } from '../../../lib/catalogueListingConfigurationValidation';

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
      const { payload, error: validationError } = validateListingFields(req.body, { isCreate: true, requireListingType: true });
      if (validationError) return res.status(400).json({ error: validationError });
      const categoryError = await assertCategory(payload.category_id, res);
      if (categoryError) return;

      if (payload.listing_type === 'service'
        && (!payload.service_scope || !payload.service_terms || payload.service_scope_confirmed !== true)) {
        return res.status(400).json({ error: 'Add the complete service scope and terms, then confirm they describe the full offering.' });
      }
      if (payload.listing_type === 'product'
        && (!payload.product_details?.fulfillment_methods?.length)) {
        return res.status(400).json({ error: 'Choose at least one product fulfillment method.' });
      }
      if (payload.listing_type === 'product' && !payload.images?.length) {
        return res.status(400).json({ error: 'Add at least one product image before publishing.' });
      }
      if (payload.listing_type === 'service'
        && !payload.service_details?.service_modes?.length) {
        return res.status(400).json({ error: 'Choose at least one service delivery method.' });
      }
      if (payload.pricing_model === 'per_session' && !payload.service_details?.typical_duration_minutes) {
        return res.status(400).json({ error: 'Per-session services need a positive session duration.' });
      }

      const { data: category, error: categoryLookupError } = await supabase
        .from('catalogue_categories')
        .select('listing_types')
        .eq('id', payload.category_id)
        .maybeSingle();
      if (categoryLookupError && categoryLookupError.code !== '42703') {
        console.error('Catalogue category compatibility lookup error:', categoryLookupError);
        return res.status(500).json({ error: 'Could not validate category compatibility.' });
      }
      if (category?.listing_types && !category.listing_types.includes(payload.listing_type)) {
        return res.status(400).json({ error: 'This category does not support the selected listing type.' });
      }

      const { data: pricingModel, error: pricingLookupError } = await supabase
        .from('catalogue_pricing_models')
        .select('key, applies_to, is_active, checkout_compatible, requires_unit')
        .eq('key', payload.pricing_model)
        .maybeSingle();
      if (pricingLookupError && pricingLookupError.code !== '42P01') {
        console.error('Catalogue pricing model lookup error:', pricingLookupError);
        return res.status(500).json({ error: 'Could not validate pricing configuration.' });
      }
      if (!pricingModel && pricingLookupError?.code === '42P01') {
        if (payload.pricing_model !== 'fixed') {
          return res.status(400).json({ error: 'This pricing option is not available until listing configuration is installed.' });
        }
      } else if (!pricingModel || !pricingModel.is_active || !pricingModel.checkout_compatible
        || !pricingModel.applies_to.includes(payload.listing_type)
        || (pricingModel.requires_unit && !payload.price_unit)) {
        return res.status(400).json({ error: 'This pricing configuration is not supported for a published listing.' });
      }
      const unitError = await validateConfiguredUnit(payload.price_unit, payload.listing_type, res);
      if (unitError) return;
      const attributeError = await validateConfiguredAttributes(payload.attributes || [], payload.category_id, payload.listing_type, res);
      if (attributeError) return;

      const { data, error } = await supabase
        .from('catalogue_items')
        .insert({
          ...Object.fromEntries(Object.entries(payload).filter(([key]) => !['product_details', 'service_details', 'attributes'].includes(key))),
          seller_username: participant.username, // never trust a client-supplied seller_username
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Catalogue item create error:', error);
        if (error.code === '23514') return res.status(400).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to create item' });
      }
      const metadataError = await saveListingMetadata(data.id, payload);
      if (metadataError) {
        console.error('Catalogue listing metadata create error:', metadataError);
        await supabase.from('catalogue_items').update({ status: 'deleted' }).eq('id', data.id).eq('seller_username', participant.username);
        return res.status(500).json({ error: 'Listing metadata could not be saved. The listing was not published.' });
      }
      return res.status(201).json(data);
    }

    if (req.method === 'PATCH') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { data: existing, error: lookupError } = await supabase
        .from('catalogue_items')
        .select('seller_username, status, listing_type, category_id, pricing_model, price_unit, service_scope, service_terms, service_scope_confirmed')
        .eq('id', id)
        .single();

      if (lookupError || !existing || existing.status === 'deleted') {
        return res.status(404).json({ error: 'Item not found' });
      }
      if (existing.seller_username !== participant.username) {
        return res.status(403).json({ error: 'Not authorized for this item' });
      }

      const { payload, error: validationError } = validateListingFields(req.body, { isCreate: false, requireListingType: true });
      if (validationError) return res.status(400).json({ error: validationError });
      if (payload.category_id) {
        const categoryError = await assertCategory(payload.category_id, res);
        if (categoryError) return;
      }
      const targetType = payload.listing_type || existing.listing_type || 'product';
      const targetModel = payload.pricing_model || existing.pricing_model || 'fixed';
      const { data: modelConfiguration, error: modelError } = await supabase
        .from('catalogue_pricing_models')
        .select('key, applies_to, is_active, checkout_compatible, requires_unit')
        .eq('key', targetModel)
        .maybeSingle();
      if (modelError && modelError.code !== '42P01') {
        console.error('Catalogue pricing model lookup error:', modelError);
        return res.status(500).json({ error: 'Could not validate pricing configuration.' });
      }
      if ((!modelError && (!modelConfiguration || !modelConfiguration.is_active || !modelConfiguration.checkout_compatible
        || !modelConfiguration.applies_to.includes(targetType) || (modelConfiguration.requires_unit && !(payload.price_unit || existing.price_unit))))
        || (modelError?.code === '42P01' && targetModel !== 'fixed')) {
        return res.status(400).json({ error: 'This pricing option is not supported for published listings.' });
      }
      const unitError = await validateConfiguredUnit(payload.price_unit, targetType, res);
      if (unitError) return;
      if (targetType === 'service') {
        const scope = payload.service_scope === undefined ? existing.service_scope : payload.service_scope;
        const terms = payload.service_terms === undefined ? existing.service_terms : payload.service_terms;
        const confirmed = payload.service_scope_confirmed === undefined ? existing.service_scope_confirmed : payload.service_scope_confirmed;
        if ((scope !== undefined && !scope) || (terms !== undefined && !terms)
          || (confirmed !== undefined && confirmed !== true)) {
          return res.status(400).json({ error: 'Published services require complete scope and terms confirmed by the seller.' });
        }
        if (!scope || !terms || confirmed !== true) {
          return res.status(400).json({ error: 'Published services require complete scope and terms confirmed by the seller.' });
        }
        let currentServiceDetails = null;
        if (payload.service_details === undefined) {
          const { data: details, error: detailsError } = await supabase
            .from('catalogue_service_details')
            .select('service_modes, typical_duration_minutes')
            .eq('item_id', id)
            .maybeSingle();
          if (detailsError && detailsError.code !== 'PGRST116') {
            console.error('Catalogue service details lookup error:', detailsError);
            return res.status(500).json({ error: 'Could not validate service details.' });
          }
          currentServiceDetails = details;
        }
        const serviceDetails = payload.service_details || currentServiceDetails;
        if (targetModel === 'per_session' && !(serviceDetails?.typical_duration_minutes > 0)) {
          return res.status(400).json({ error: 'Per-session services need a positive session duration.' });
        }
        if (!serviceDetails?.service_modes?.length) {
          return res.status(400).json({ error: 'Choose at least one service delivery method.' });
        }
      }
      if (targetType === 'product' && payload.product_details && !payload.product_details.fulfillment_methods?.length) {
        return res.status(400).json({ error: 'Choose at least one product fulfillment method.' });
      }
      const categoryId = payload.category_id || existing.category_id;
      if (payload.listing_type !== undefined || payload.category_id !== undefined) {
        const compatibility = await assertListingCategoryCompatibility(categoryId, targetType, res);
        if (compatibility) return;
      }
      if (payload.attributes !== undefined || payload.category_id !== undefined || payload.listing_type !== undefined) {
        const attributeError = await validateConfiguredAttributes(payload.attributes || [], categoryId, targetType, res);
        if (attributeError) return;
      }
      const metadata = {};
      for (const key of ['product_details', 'service_details', 'attributes']) {
        if (payload[key] !== undefined) {
          metadata[key] = payload[key];
          delete payload[key];
        }
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
        if (error.code === '23514') return res.status(400).json({ error: error.message });
        return res.status(500).json({ error: 'Failed to update item' });
      }
      const metadataError = await saveListingMetadata(id, metadata);
      if (metadataError) {
        console.error('Catalogue listing metadata update error:', metadataError);
        return res.status(500).json({ error: 'Listing metadata could not be saved.' });
      }
      return res.status(200).json(data);
    }

    async function saveListingMetadata(itemId, payload) {
      const operations = [];
      if (payload.product_details !== undefined || payload.service_details !== undefined) {
        const type = payload.listing_type || (payload.product_details ? 'product' : 'service');
        const table = type === 'service' ? 'catalogue_service_details' : 'catalogue_product_details';
        const details = type === 'service' ? payload.service_details : payload.product_details;
        if (details !== undefined) {
          operations.push(supabase.from(table).upsert({ item_id: itemId, ...details, updated_at: new Date().toISOString() }));
        }
      }
      if (payload.attributes !== undefined) {
        const { error: deleteError } = await supabase.from('catalogue_item_attributes').delete().eq('item_id', itemId);
        if (deleteError) return deleteError;
        if (payload.attributes.length) {
          operations.push(supabase.from('catalogue_item_attributes').insert(payload.attributes.map((attribute) => ({
            item_id: itemId,
            attribute_id: attribute.attribute_id || null,
            custom_label: attribute.custom_label || null,
            value: attribute.value,
          }))));
        }
      }
      if (operations.length) {
        const results = await Promise.all(operations);
        const failed = results.find((result) => result.error);
        if (failed) return failed.error;
      }
      return null;
    }

    async function validateConfiguredUnit(unit, listingType, res) {
      const error = await configuredUnitError(supabase, unit, listingType);
      if (!error) return false;
      res.status(error === 'Could not validate pricing unit.' ? 500 : 400).json({ error });
      return true;
    }

    async function validateConfiguredAttributes(attributes, categoryId, listingType, res) {
      const error = await configuredAttributesError(supabase, attributes, categoryId, listingType);
      if (!error) return false;
      res.status(error === 'Could not validate category fields.' ? 500 : 400).json({ error });
      return true;
    }

    async function assertListingCategoryCompatibility(categoryId, listingType, res) {
      const { data, error } = await supabase
        .from('catalogue_categories')
        .select('listing_types')
        .eq('id', categoryId)
        .maybeSingle();
      if (error?.code === '42703') return false;
      if (error) {
        console.error('Catalogue category compatibility lookup error:', error);
        res.status(500).json({ error: 'Could not validate category compatibility.' });
        return true;
      }
      if (!data || (data.listing_types && !data.listing_types.includes(listingType))) {
        res.status(400).json({ error: 'This category does not support the selected listing type.' });
        return true;
      }
      return false;
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
