import { getSupabase } from '../lib/supabase';
import { API_BASE_URL, ApiError, apiFetch } from '../lib/api-client';

export type CatalogueItem = {
  id: string;
  seller_username: string;
  title: string;
  description: string;
  price_usd: number;
  size?: string | null;
  promo_video_url?: string | null;
  images: string[];
  payment_methods: ('paystack' | 'usdt')[];
  status: 'active' | 'paused' | 'deleted';
  created_at: string;
};

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
  buyer_token: string;
  notes?: string;
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
  return (data as CatalogueItem[]) || [];
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
  return (data as CatalogueItem[]) || [];
}

export async function getCatalogueItem(id: string): Promise<CatalogueItem | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('catalogue_items').select('*').eq('id', id).single();
  if (error) return null;
  return data as CatalogueItem;
}

// --- Writes: authenticated Next.js routes (pages/api/catalogue/*.js) ---

export async function createItem(
  token: string,
  input: Pick<CatalogueItem, 'title' | 'description' | 'price_usd' | 'size' | 'promo_video_url' | 'images' | 'payment_methods' | 'status'>
): Promise<CatalogueItem> {
  return apiFetch('/api/catalogue/items', { method: 'POST', token, body: input });
}

export async function updateItem(
  token: string,
  id: string,
  input: Partial<Pick<CatalogueItem, 'title' | 'description' | 'price_usd' | 'size' | 'promo_video_url' | 'images' | 'payment_methods' | 'status'>>
): Promise<CatalogueItem> {
  return apiFetch('/api/catalogue/items', { method: 'PATCH', token, body: { id, ...input } });
}

export async function deleteItem(token: string, id: string): Promise<void> {
  await apiFetch('/api/catalogue/items', { method: 'DELETE', token, body: { id } });
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
