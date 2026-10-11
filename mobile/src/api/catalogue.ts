import { getSupabase } from '../lib/supabase';
import { API_BASE_URL, ApiError, apiFetch } from '../lib/api-client';

export type CatalogueCategory = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  tint: string;
  ink: string;
  sort_order: number;
  parent_id?: string | null;
  is_featured?: boolean;
  is_active?: boolean;
  is_selectable?: boolean;
  image_url?: string | null;
  banner_title?: string | null;
  banner_subtitle?: string | null;
  listing_types?: ('product' | 'service')[];
  suggested_listing_type?: 'product' | 'service' | null;
};

export type CatalogueListingType = 'product' | 'service';
export type CatalogueProductDetails = {
  condition?: 'new' | 'used_like_new' | 'used_good' | 'used_fair' | 'refurbished' | 'not_applicable' | null;
  brand?: string | null;
  sku?: string | null;
  fulfillment_methods?: ('delivery' | 'pickup' | 'shipping' | 'digital_delivery')[];
  delivery_areas?: string | null;
  estimated_dispatch_days?: number | null;
};
export type CatalogueServiceDetails = {
  service_modes?: ('on_site' | 'at_provider' | 'remote')[];
  service_area?: string | null;
  typical_duration_minutes?: number | null;
  experience_years?: number | null;
};
export type CatalogueAttributeDefinition = {
  id: string;
  key: string;
  label: string;
  input_type: 'text' | 'number' | 'select' | 'multi_select' | 'boolean';
  options: (string | { label: string; value: string })[];
  is_required: boolean;
  allow_other: boolean;
  min_number?: number | null;
  max_number?: number | null;
  listing_type?: CatalogueListingType | null;
};
export type CatalogueListingConfiguration = {
  units: { key: string; label: string; applies_to: CatalogueListingType[] }[];
  pricing_models: { key: string; label: string; applies_to: CatalogueListingType[]; requires_unit: boolean; requires_price: boolean; checkout_compatible: boolean }[];
  attributes: CatalogueAttributeDefinition[];
};

export type CatalogueItem = {
  id: string;
  seller_username: string;
  title: string;
  description: string;
  price_usd: number;
  size?: string | null;
  category_id?: string | null;
  promo_video_url?: string | null;
  images: string[];
  payment_methods: ('paystack' | 'usdt')[];
  status: 'active' | 'paused' | 'deleted';
  created_at: string;
  listing_type?: CatalogueListingType;
  pricing_model?: string;
  price_unit?: string | null;
  service_scope?: string | null;
  service_terms?: string | null;
  service_scope_confirmed?: boolean;
  product_details?: CatalogueProductDetails | null;
  service_details?: CatalogueServiceDetails | null;
  attributes?: { id?: string; attribute_id?: string | null; custom_label?: string | null; value: unknown }[];
};

export type CatalogueListingDraft = {
  id: string;
  listing_type: CatalogueListingType;
  category_id: string | null;
  title: string;
  description: string | null;
  pricing_model: string;
  price_usd: number | string | null;
  price_max_usd: number | string | null;
  price_unit: string | null;
  min_order_qty: number | null;
  max_order_qty: number | null;
  stock_status: 'in_stock' | 'limited' | 'made_to_order' | 'preorder' | 'out_of_stock' | null;
  stock_quantity: number | null;
  service_scope: string | null;
  service_terms: string | null;
  service_scope_confirmed: boolean;
  product_details: CatalogueProductDetails;
  service_details: CatalogueServiceDetails;
  attributes: { attribute_id?: string; custom_label?: string; value: unknown }[];
  pricing_options: { label: string; price_usd: number | null; price_unit: string | null }[];
  images: string[];
  promo_video_url: string | null;
  blocking_reasons: string[];
  published_item_id: string | null;
  updated_at: string;
};

export function cataloguePriceLabel(item: CatalogueItem): string {
  const amount = `$${Number(item.price_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (item.listing_type === 'product' && item.pricing_model === 'per_unit' && item.price_unit) {
    const unit = item.price_unit.startsWith('other:') ? item.price_unit.slice(6).trim() : item.price_unit.replaceAll('_', ' ');
    return `${amount} / ${unit}`;
  }
  if (item.listing_type === 'service' && item.pricing_model === 'per_session') return `${amount} / session`;
  return amount;
}

export type CatalogueOrder = {
  id: string;
  item_id: string;
  seller_username: string;
  buyer_name: string;
  buyer_email: string;
  buyer_whatsapp?: string;
  amount_usd: number;
  amount_ngn?: number;
  payment_method: 'paystack' | 'usdt';
  network?: 'bsc' | 'tron';
  payment_ref?: string | null;
  tx_hash?: string | null;
  status: 'paid' | 'pending_verification' | 'buyer_confirmed' | 'disputed' | 'released';
  buyer_token?: string; // only on the buyer's own copy - never sent to sellers
  notes?: string;
  delivery_address?: string | null;
  quantity?: number;
  commission_percent?: number | null;
  commission_usd?: number | null;
  seller_net_usd?: number | null;
  buyer_confirmed_at?: string | null;
  created_at: string;
  catalogue_items?: { title: string; images?: string[]; price_usd?: number; seller_username?: string };
};

// --- Reads: direct Supabase (anon key), intentionally public - mirrors
// public/js/supabase-config.js's getPublicCatalogueByUsername/getCatalogueItem ---

export async function getPublicCatalogueByUsername(username: string): Promise<CatalogueItem[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('catalogue_items')
    .select('*')
    .eq('seller_username', username)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return attachListingMetadata((data as CatalogueItem[]) || []);
}

export async function getCatalogueByUsername(username: string): Promise<CatalogueItem[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('catalogue_items')
    .select('*')
    .eq('seller_username', username)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return attachListingMetadata((data as CatalogueItem[]) || []);
}

async function attachListingMetadata(items: CatalogueItem[]): Promise<CatalogueItem[]> {
  if (!items.length) return items;
  const ids = items.map((item) => item.id);
  const supabase = await getSupabase();
  const [products, services, attributes] = await Promise.all([
    supabase.from('catalogue_product_details').select('*').in('item_id', ids),
    supabase.from('catalogue_service_details').select('*').in('item_id', ids),
    supabase.from('catalogue_item_attributes').select('id, item_id, attribute_id, custom_label, value').in('item_id', ids),
  ]);
  for (const result of [products, services, attributes]) {
    if (result.error && !['42P01', 'PGRST205'].includes(result.error.code || '')) throw result.error;
  }
  const productByItem = new Map((products.data || []).map((row) => [row.item_id, row]));
  const serviceByItem = new Map((services.data || []).map((row) => [row.item_id, row]));
  const attributesByItem = new Map<string, NonNullable<CatalogueItem['attributes']>>();
  for (const row of attributes.data || []) {
    const list = attributesByItem.get(row.item_id) || [];
    list.push(row);
    attributesByItem.set(row.item_id, list);
  }
  return items.map((item) => ({
    ...item,
    product_details: productByItem.get(item.id) || null,
    service_details: serviceByItem.get(item.id) || null,
    attributes: attributesByItem.get(item.id) || [],
  }));
}

const CATEGORY_FIELDS = 'id, name, slug, icon, tint, ink, sort_order, parent_id, is_featured, is_active, is_selectable, image_url, banner_title, banner_subtitle';
const CATEGORY_FIELDS_WITHOUT_BANNERS = 'id, name, slug, icon, tint, ink, sort_order, parent_id, is_featured, is_active, is_selectable';
const CATEGORY_FIELDS_BASE = 'id, name, slug, icon, tint, ink, sort_order, parent_id, is_featured, is_active';

export async function getCategories(): Promise<CatalogueCategory[]> {
  const supabase = await getSupabase();
  const listed = (fields: string) => supabase
    .from('catalogue_categories')
    .select(fields)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .overrideTypes<CatalogueCategory[]>();
  let { data, error } = await listed(CATEGORY_FIELDS);
  if (error && /image_url|banner_title|banner_subtitle/.test(error.message || '')) {
    ({ data, error } = await listed(CATEGORY_FIELDS_WITHOUT_BANNERS));
  }
  if (error && /is_selectable/.test(error.message || '')) {
    ({ data, error } = await listed(CATEGORY_FIELDS_BASE));
  }
  if (error && /listing_types|suggested_listing_type/.test(error.message || '')) {
    const legacyFields = 'id, name, slug, icon, tint, ink, sort_order, parent_id, is_featured, is_active, is_selectable';
    const legacyResult = await listed(legacyFields);
    if (legacyResult.error) throw legacyResult.error;
    return (legacyResult.data || []).map((category) => ({
      ...category,
      listing_types: ['product', 'service'],
      suggested_listing_type: null,
    }));
  }
  if (error) throw error;
  return data || [];
}

export async function getCatalogueListingConfiguration(categoryId: string | null, listingType: CatalogueListingType): Promise<CatalogueListingConfiguration> {
  const supabase = await getSupabase();
  const [units, models, attributes] = await Promise.all([
    supabase.from('catalogue_units').select('key, label, applies_to').eq('is_active', true).order('sort_order'),
    supabase.from('catalogue_pricing_models').select('key, label, applies_to, requires_unit, requires_price, checkout_compatible').eq('is_active', true).order('sort_order'),
    supabase.from('catalogue_attribute_definitions')
      .select('id, key, label, input_type, options, is_required, allow_other, min_number, max_number, listing_type')
      .eq('is_active', true)
      .or(categoryId ? `category_id.is.null,category_id.eq.${categoryId}` : 'category_id.is.null'),
  ]);
  for (const result of [units, models, attributes]) {
    if (result.error && !['42P01', 'PGRST205'].includes(result.error.code || '')) throw result.error;
  }
  return {
    units: units.data || [
      { key: 'piece', label: 'piece', applies_to: ['product'] },
      { key: 'kg', label: 'kg', applies_to: ['product'] },
      { key: 'metre', label: 'metre', applies_to: ['product', 'service'] },
      { key: 'sq_metre', label: 'sq metre', applies_to: ['product', 'service'] },
      { key: 'session', label: 'session', applies_to: ['service'] },
    ],
    pricing_models: models.data || [
      { key: 'fixed', label: 'Fixed price', applies_to: ['product', 'service'], requires_unit: false, requires_price: true, checkout_compatible: true },
      { key: 'per_unit', label: 'Price per unit', applies_to: ['product'], requires_unit: true, requires_price: true, checkout_compatible: true },
      { key: 'per_session', label: 'Per session', applies_to: ['service'], requires_unit: false, requires_price: true, checkout_compatible: true },
    ],
    attributes: (attributes.data || []).filter((attribute) => !attribute.listing_type || attribute.listing_type === listingType) as CatalogueAttributeDefinition[],
  };
}

export async function createCategory(token: string, name: string, parentId?: string | null): Promise<CatalogueCategory> {
  return apiFetch('/api/catalogue/categories', { method: 'POST', token, body: { name, parent_id: parentId || null } });
}

/** Latest live listings. For You, New, and Popular share this until a ranking API exists. */
export function getShopFeed(categoryIds?: string[] | null) {
  return getShopItems(categoryIds);
}

export async function getShopItems(categoryIds?: string[] | null): Promise<CatalogueItem[]> {
  const supabase = await getSupabase();
  const fields = 'id, seller_username, title, description, price_usd, size, category_id, promo_video_url, images, payment_methods, status, created_at, listing_type, pricing_model, price_unit';
  let query = supabase
    .from('catalogue_items')
    .select(fields)
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (categoryIds?.length === 1) query = query.eq('category_id', categoryIds[0]);
  else if (categoryIds?.length) query = query.in('category_id', categoryIds);
  let { data, error } = await query;
  if (error && /listing_type|pricing_model|price_unit/.test(error.message || '')) {
    let fallback = supabase
      .from('catalogue_items')
      .select('id, seller_username, title, description, price_usd, size, category_id, promo_video_url, images, payment_methods, status, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (categoryIds?.length === 1) fallback = fallback.eq('category_id', categoryIds[0]);
    else if (categoryIds?.length) fallback = fallback.in('category_id', categoryIds);
    const fallbackResult = await fallback;
    if (fallbackResult.error) throw fallbackResult.error;
    return (fallbackResult.data as CatalogueItem[]) || [];
  }
  if (error) throw error;
  return (data as CatalogueItem[]) || [];
}

export async function getCatalogueItem(id: string): Promise<CatalogueItem | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('catalogue_items').select('*').eq('id', id).single();
  if (error) return null;
  const item = data as CatalogueItem;
  return (await attachListingMetadata([item]))[0];
}

// --- Writes: authenticated Next.js routes (pages/api/catalogue/*.js) ---

export async function createItem(
  token: string,
  input: Pick<CatalogueItem, 'title' | 'description' | 'price_usd' | 'size' | 'category_id' | 'promo_video_url' | 'images' | 'payment_methods' | 'status'>
    & Pick<CatalogueItem, 'listing_type'>
    & Partial<Pick<CatalogueItem, 'pricing_model' | 'price_unit' | 'service_scope' | 'service_terms' | 'service_scope_confirmed' | 'product_details' | 'service_details' | 'attributes'>>
): Promise<CatalogueItem> {
  return apiFetch('/api/catalogue/items', { method: 'POST', token, body: input });
}

export async function updateItem(
  token: string,
  id: string,
  input: Partial<Pick<CatalogueItem, 'title' | 'description' | 'price_usd' | 'size' | 'category_id' | 'promo_video_url' | 'images' | 'payment_methods' | 'status' | 'listing_type' | 'pricing_model' | 'price_unit' | 'service_scope' | 'service_terms' | 'service_scope_confirmed' | 'product_details' | 'service_details' | 'attributes'>>
): Promise<CatalogueItem> {
  return apiFetch('/api/catalogue/items', { method: 'PATCH', token, body: { id, ...input } });
}

export async function deleteItem(token: string, id: string): Promise<void> {
  await apiFetch('/api/catalogue/items', { method: 'DELETE', token, body: { id } });
}

export async function getCatalogueDrafts(token: string): Promise<CatalogueListingDraft[]> {
  const result = await apiFetch<{ drafts: CatalogueListingDraft[] }>('/api/catalogue/drafts', { token });
  return result.drafts;
}

export async function saveCatalogueDraft(
  token: string,
  input: Partial<CatalogueListingDraft> & Pick<CatalogueListingDraft, 'title' | 'listing_type' | 'pricing_model'>
): Promise<CatalogueListingDraft> {
  return apiFetch('/api/catalogue/drafts', { method: 'POST', token, body: input });
}

export async function publishCatalogueDraft(token: string, id: string): Promise<{ item: CatalogueItem; draft: CatalogueListingDraft }> {
  return apiFetch('/api/catalogue/drafts', {
    method: 'PATCH',
    token,
    body: { id, action: 'publish', payment_methods: ['paystack', 'usdt'] },
  });
}

export async function deleteCatalogueDraft(token: string, id: string): Promise<void> {
  await apiFetch('/api/catalogue/drafts', { method: 'DELETE', token, body: { id } });
}

export async function createItemPaymentIntent(input: {
  item_id: string;
  callback_url: string;
}): Promise<{ authorization_url: string; reference: string; amount_usd: number }> {
  return apiFetch('/api/catalogue/create-payment-intent', { method: 'POST', body: input });
}

export async function createOrder(input: {
  item_id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_whatsapp?: string;
  delivery_address?: string;
  notes?: string;
  payment_method: 'paystack' | 'usdt';
  network?: 'bsc' | 'tron';
  payment_ref?: string;
  tx_hash?: string;
}): Promise<CatalogueOrder> {
  return apiFetch('/api/catalogue/verify-order', { method: 'POST', body: input });
}

export async function orderAction(input: {
  order_id: string;
  action: 'confirm_delivery' | 'raise_dispute' | 'release_funds';
  buyer_token?: string;
  token?: string; // participant token, for release_funds
}): Promise<{ success: boolean; order: CatalogueOrder }> {
  const { token, ...body } = input;
  return apiFetch('/api/catalogue/order-action', { method: 'POST', token, body });
}

export async function getMyOrders(token: string): Promise<CatalogueOrder[]> {
  const data = await apiFetch<{ orders: CatalogueOrder[] }>('/api/catalogue/orders', { token });
  return data.orders;
}

export type CatalogueMediaUpload = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export async function uploadCatalogueMedia(token: string, media: CatalogueMediaUpload): Promise<{
  public_url: string;
  media_type: 'video_upload' | 'photo_upload';
}> {
  const formData = new FormData();
  const isVideo = media.mimeType?.startsWith('video/') ?? false;
  formData.append('media', {
    uri: media.uri,
    name: media.fileName || `catalogue-${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
    type: media.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
  } as never);

  const response = await fetch(`${API_BASE_URL}/api/onedream/profile/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await response.json().catch(() => ({})) as { error?: string; public_url?: string; media_type?: 'video_upload' | 'photo_upload' };
  if (!response.ok || !data.public_url || !data.media_type) {
    throw new ApiError(data.error || 'Media upload failed', response.status, data);
  }
  return { public_url: data.public_url, media_type: data.media_type };
}
