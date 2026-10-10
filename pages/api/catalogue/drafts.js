import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import { parsePriceUsd, validateListingFields, validateListingDraftFields } from '../../../lib/catalogueListingValidation';
import { configuredAttributesError, configuredUnitError } from '../../../lib/catalogueListingConfigurationValidation';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function publicDraft(row) {
  const serviceDetails = { ...(row.service_details || {}) };
  const serviceScopeConfirmed = serviceDetails.scope_confirmed === true;
  delete serviceDetails.scope_confirmed;
  return { ...row, service_details: serviceDetails, service_scope_confirmed: serviceScopeConfirmed };
}

function draftReasons(draft, pricingModel) {
  const reasons = [];
  if (!draft.category_id) reasons.push('Choose a category.');
  if (!pricingModel?.checkout_compatible) reasons.push('This pricing model is not approved for the existing checkout.');
  if (pricingModel?.requires_price && !draft.price_usd) reasons.push('Enter a positive advertised price.');
  if (draft.price_max_usd && draft.price_usd && Number(draft.price_max_usd) !== Number(draft.price_usd)) {
    reasons.push('A price range requires a quote or pricing flow that is not part of the existing checkout.');
  }
  if (draft.stock_status || draft.stock_quantity !== null || (draft.min_order_qty && draft.min_order_qty > 1)
    || (draft.max_order_qty && draft.max_order_qty > 1)) {
    reasons.push('Inventory and quantity limits cannot be enforced by the existing checkout.');
  }
  if (draft.pricing_options?.length) reasons.push('Multiple pricing options are draft-only because checkout handles one advertised item price.');
  if (draft.listing_type === 'product') {
    if (!draft.images?.length) reasons.push('Add at least one product image.');
    if (!draft.product_details?.fulfillment_methods?.length) reasons.push('Choose at least one product fulfillment method.');
  } else {
    if (!draft.service_scope || !draft.service_terms || !draft.service_details?.scope_confirmed) {
      reasons.push('Add complete service scope and terms, then confirm the description.');
    }
    if (!draft.service_details?.service_modes?.length) reasons.push('Choose at least one service delivery method.');
    if (draft.pricing_model === 'per_session' && !(draft.service_details?.typical_duration_minutes > 0)) {
      reasons.push('Add a positive session duration.');
    }
  }
  return reasons;
}

async function validateDraftConfiguration(payload, res, { publishing = false } = {}) {
  const { data: model, error: modelError } = await supabase
    .from('catalogue_pricing_models')
    .select('key, applies_to, requires_unit, requires_price, checkout_compatible, is_active')
    .eq('key', payload.pricing_model)
    .maybeSingle();
  if (modelError) {
    console.error('Catalogue draft pricing model lookup error:', modelError);
    res.status(modelError.code === '42P01' || modelError.code === 'PGRST205' ? 503 : 500).json({
      error: modelError.code === '42P01' || modelError.code === 'PGRST205'
        ? 'Listing configuration is unavailable. Apply the listing-engine migration before saving drafts.'
        : 'Could not validate the selected pricing model.',
    });
    return null;
  }
  if (!model || !model.is_active || !model.applies_to.includes(payload.listing_type)) {
    res.status(400).json({ error: 'Choose an active pricing model configured for this listing type.' });
    return null;
  }
  if (model.requires_unit && !payload.price_unit) {
    res.status(400).json({ error: 'This pricing model requires a pricing unit.' });
    return null;
  }
  const unitError = await configuredUnitError(supabase, payload.price_unit, payload.listing_type);
  if (unitError) {
    res.status(unitError === 'Could not validate pricing unit.' ? 500 : 400).json({ error: unitError });
    return null;
  }
  if (payload.category_id) {
    const { data: category, error: categoryError } = await supabase
      .from('catalogue_categories')
      .select('id, parent_id, is_active, is_selectable, listing_types')
      .eq('id', payload.category_id)
      .maybeSingle();
    if (categoryError) {
      console.error('Catalogue draft category lookup error:', categoryError);
      res.status(500).json({ error: 'Could not validate the selected category.' });
      return null;
    }
    if (!category || category.is_active === false || category.is_selectable === false
      || (category.listing_types && !category.listing_types.includes(payload.listing_type))) {
      res.status(400).json({ error: 'Choose an active, compatible listing category.' });
      return null;
    }
    const { count, error: childError } = await supabase
      .from('catalogue_categories')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', category.id);
    if (childError) {
      console.error('Catalogue draft category child lookup error:', childError);
      res.status(500).json({ error: 'Could not validate the selected category.' });
      return null;
    }
    if ((count || 0) > 0) {
      res.status(400).json({ error: 'Choose a specific category inside a department.' });
      return null;
    }
    const attributesError = await configuredAttributesError(
      supabase,
      payload.attributes || [],
      category.id,
      payload.listing_type,
      { requireRequiredFields: publishing }
    );
    if (attributesError) {
      const isConfigurationError = attributesError === 'Could not validate category fields.';
      res.status(isConfigurationError ? 500 : 400).json({ error: attributesError });
      return null;
    }
  }
  return model;
}

async function saveMetadata(itemId, draft) {
  const detailTable = draft.listing_type === 'service' ? 'catalogue_service_details' : 'catalogue_product_details';
  const details = draft.listing_type === 'service' ? draft.service_details : draft.product_details;
  const detailResult = await supabase.from(detailTable).upsert({ item_id: itemId, ...(details || {}), updated_at: new Date().toISOString() });
  if (detailResult.error) return detailResult.error;
  const { error: deleteError } = await supabase.from('catalogue_item_attributes').delete().eq('item_id', itemId);
  if (deleteError) return deleteError;
  if (draft.attributes?.length) {
    const { error } = await supabase.from('catalogue_item_attributes').insert(draft.attributes.map((attribute) => ({
      item_id: itemId,
      attribute_id: attribute.attribute_id || null,
      custom_label: attribute.custom_label || null,
      value: attribute.value,
    })));
    if (error) return error;
  }
  return null;
}

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('catalogue_listing_drafts')
        .select('*')
        .eq('seller_username', participant.username)
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('Catalogue drafts list error:', error);
        const migrationMissing = error.code === '42P01' || error.code === 'PGRST205';
        return res.status(migrationMissing ? 503 : 500).json({
          error: migrationMissing ? 'Listing drafts are unavailable. Apply the listing-engine migration first.' : 'Could not load listing drafts.',
        });
      }
      return res.status(200).json({ drafts: (data || []).map(publicDraft) });
    }

    if (req.method === 'POST') {
      const input = req.body || {};
      const { id: draftIdInput, ...draftInput } = input;
      const { payload, error: validationError } = validateListingDraftFields(draftInput);
      if (validationError) return res.status(400).json({ error: validationError });
      const model = await validateDraftConfiguration(payload, res);
      if (!model) return;
      const reasons = draftReasons({
        ...payload,
        product_details: payload.product_details || {},
        service_details: { ...(payload.service_details || {}), scope_confirmed: payload.service_scope_confirmed },
      }, model);
      if (payload.category_id) {
        const requiredAttributeError = await configuredAttributesError(
          supabase, payload.attributes || [], payload.category_id, payload.listing_type, { requireRequiredFields: true }
        );
        if (requiredAttributeError) reasons.push(requiredAttributeError);
      }
      const row = {
        ...payload,
        seller_username: participant.username,
        product_details: payload.product_details || {},
        service_details: { ...(payload.service_details || {}), scope_confirmed: payload.service_scope_confirmed },
        blocking_reasons: reasons,
        updated_at: new Date().toISOString(),
      };
      delete row.service_scope_confirmed;
      const draftId = typeof draftIdInput === 'string' ? draftIdInput : null;
      let result;
      if (draftId) {
        const { data: existing, error: lookupError } = await supabase
          .from('catalogue_listing_drafts')
          .select('id, seller_username, published_item_id')
          .eq('id', draftId)
          .maybeSingle();
        if (lookupError) {
          console.error('Catalogue draft lookup error:', lookupError);
          return res.status(500).json({ error: 'Could not load this draft.' });
        }
        if (!existing) return res.status(404).json({ error: 'Draft not found.' });
        if (existing.seller_username !== participant.username) return res.status(403).json({ error: 'Not authorized for this draft.' });
        if (existing.published_item_id) return res.status(409).json({ error: 'Published drafts cannot be edited.' });
        result = await supabase.from('catalogue_listing_drafts')
          .update(row).eq('id', draftId).eq('seller_username', participant.username)
          .is('published_item_id', null).select('*').single();
      } else {
        result = await supabase.from('catalogue_listing_drafts').insert(row).select('*').single();
      }
      if (result.error) {
        console.error('Catalogue draft save error:', result.error);
        if (result.error.code === 'PGRST116') return res.status(409).json({ error: 'This draft was published before the update completed.' });
        return res.status(500).json({ error: 'Could not save listing draft.' });
      }
      return res.status(draftId ? 200 : 201).json(publicDraft(result.data));
    }

    if (req.method === 'PATCH') {
      const id = req.body?.id;
      if (req.body?.action !== 'publish' || typeof id !== 'string') {
        return res.status(400).json({ error: 'Choose a draft to publish.' });
      }
      const { data: draft, error: lookupError } = await supabase
        .from('catalogue_listing_drafts')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (lookupError) {
        console.error('Catalogue draft publish lookup error:', lookupError);
        return res.status(500).json({ error: 'Could not load this draft.' });
      }
      if (!draft) return res.status(404).json({ error: 'Draft not found.' });
      if (draft.seller_username !== participant.username) return res.status(403).json({ error: 'Not authorized for this draft.' });
      if (draft.published_item_id) return res.status(409).json({ error: 'This draft has already been published.' });

      const serviceDetails = { ...(draft.service_details || {}) };
      const serviceScopeConfirmed = serviceDetails.scope_confirmed === true;
      delete serviceDetails.scope_confirmed;
      const publishInput = {
        title: draft.title,
        description: draft.description || '',
        category_id: draft.category_id,
        listing_type: draft.listing_type,
        pricing_model: draft.pricing_model,
        price_usd: draft.price_usd,
        price_unit: draft.price_unit,
        service_scope: draft.service_scope,
        service_terms: draft.service_terms,
        service_scope_confirmed: serviceScopeConfirmed,
        product_details: draft.product_details || {},
        service_details: serviceDetails,
        attributes: draft.attributes || [],
        images: draft.images || [],
        promo_video_url: draft.promo_video_url,
        payment_methods: req.body?.payment_methods,
        status: 'active',
      };
      const { payload, error: listingValidationError } = validateListingFields(publishInput, { isCreate: true, requireListingType: true });
      if (listingValidationError) return res.status(400).json({ error: listingValidationError });
      const model = await validateDraftConfiguration(payload, res, { publishing: true });
      if (!model) return;
      if (!model.checkout_compatible || (model.requires_price && !parsePriceUsd(draft.price_usd))) {
        return res.status(409).json({ error: 'This pricing configuration is not compatible with the current checkout. The listing remains a draft.' });
      }
      if (draft.price_max_usd && Number(draft.price_max_usd) !== Number(draft.price_usd)
        || draft.stock_status || draft.stock_quantity !== null
        || (draft.min_order_qty && draft.min_order_qty > 1)
        || (draft.max_order_qty && draft.max_order_qty > 1)
        || draft.pricing_options?.length) {
        return res.status(409).json({ error: 'Price ranges, multiple options, and inventory or quantity constraints are draft-only because checkout does not enforce them.' });
      }
      const reasons = draftReasons({
        ...draft,
        service_details: { ...(draft.service_details || {}), scope_confirmed: serviceScopeConfirmed },
      }, model);
      if (reasons.length) return res.status(409).json({ error: reasons.join(' ') });
      const unitError = await configuredUnitError(supabase, payload.price_unit, payload.listing_type);
      if (unitError) return res.status(unitError === 'Could not validate pricing unit.' ? 500 : 400).json({ error: unitError });
      const { data: item, error: createError } = await supabase.from('catalogue_items').insert({
        ...Object.fromEntries(Object.entries(payload).filter(([key]) => !['product_details', 'service_details', 'attributes'].includes(key))),
        seller_username: participant.username,
        created_at: new Date().toISOString(),
      }).select().single();
      if (createError) {
        console.error('Catalogue draft publish item create error:', createError);
        return res.status(createError.code === '23514' || createError.code === '23503' ? 400 : 500)
          .json({ error: createError.code === '23514' || createError.code === '23503'
            ? 'Could not publish this listing. Check that its details are complete.'
            : 'Could not create the published listing.' });
      }
      const metadataError = await saveMetadata(item.id, payload);
      if (metadataError) {
        console.error('Catalogue draft publish metadata error:', metadataError);
        const { error: unpublishError } = await supabase.from('catalogue_items').update({ status: 'deleted' }).eq('id', item.id).eq('seller_username', participant.username);
        if (unpublishError) console.error('Catalogue draft publish cleanup error:', unpublishError);
        return res.status(500).json({ error: 'Listing details could not be saved. The listing was not published.' });
      }
      const { data: linkedDraft, error: linkError } = await supabase
        .from('catalogue_listing_drafts')
        .update({ published_item_id: item.id, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('seller_username', participant.username)
        .is('published_item_id', null)
        .select('*')
        .single();
      if (linkError) {
        console.error('Catalogue draft publish link error:', linkError);
        const { error: unpublishError } = await supabase.from('catalogue_items').update({ status: 'deleted' }).eq('id', item.id).eq('seller_username', participant.username);
        if (unpublishError) {
          console.error('Catalogue draft link cleanup error:', unpublishError);
          return res.status(500).json({ error: 'The draft link failed and the listing could not be unpublished automatically. Contact support before retrying.' });
        }
        return res.status(500).json({ error: 'The draft link failed; the listing was unpublished.' });
      }
      return res.status(201).json({ item, draft: publicDraft(linkedDraft) });
    }

    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      if (typeof id !== 'string') return res.status(400).json({ error: 'Missing draft id.' });
      const { data: draft, error: lookupError } = await supabase
        .from('catalogue_listing_drafts')
        .select('id, seller_username, published_item_id')
        .eq('id', id)
        .maybeSingle();
      if (lookupError) {
        console.error('Catalogue draft delete lookup error:', lookupError);
        return res.status(500).json({ error: 'Could not load this draft.' });
      }
      if (!draft) return res.status(404).json({ error: 'Draft not found.' });
      if (draft.seller_username !== participant.username) return res.status(403).json({ error: 'Not authorized for this draft.' });
      if (draft.published_item_id) return res.status(409).json({ error: 'Published drafts cannot be deleted.' });
      const { error } = await supabase.from('catalogue_listing_drafts')
        .delete().eq('id', id).eq('seller_username', participant.username);
      if (error) {
        console.error('Catalogue draft delete error:', error);
        return res.status(500).json({ error: 'Could not delete this draft.' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('catalogue/drafts error:', error);
    return res.status(500).json({ error: 'Draft request failed.' });
  }
}
