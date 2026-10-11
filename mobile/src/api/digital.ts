import { ApiError, apiFetch } from '../lib/api-client';

// Digital products (e-books, audio, video) - pages/api/digital/**.
// Bought with Google Play price tiers in the Android app, or by card
// (Paystack) on the web; creators can also sell a monthly subscription.
// Content is delivered to the Library.

export type DigitalKind = 'ebook' | 'audio' | 'video';
export type DigitalAssetKind = 'pdf' | 'epub' | 'audio' | 'video';

export type DigitalContentEntry = {
  id: string;
  title: string | null;
  position: number;
  kind: DigitalAssetKind;
  pages: number | null;
  duration_seconds: number | null;
  bytes: number;
};

export type DigitalProduct = {
  item_id: string;
  kind: DigitalKind;
  status: 'draft' | 'pending_review' | 'published' | 'rejected' | 'suspended';
  seller_username: string;
  price_usd: number | null;
  tier_id: string;
  google_play_product_id: string | null;
  in_subscription?: boolean;
  contents: DigitalContentEntry[];
  preview:
    | { type: 'pages'; pages: string[] }
    | { type: 'sections'; sections: string[] }
    | { type: 'audio' | 'video'; url: string; seconds: number }
    | null;
};

export type ProductSubscriptionOffer = { creator_username: string; price_usd: number; description: string | null; subscribed: boolean };

export type DigitalProductResponse = {
  product: DigitalProduct | null;
  owned?: boolean;
  license_id?: string | null;
  is_seller?: boolean;
  web_payment?: boolean;
  subscription?: ProductSubscriptionOffer | null;
};

export function getDigitalProduct(itemId: string, token?: string | null): Promise<DigitalProductResponse> {
  return apiFetch(`/api/digital/product?item_id=${encodeURIComponent(itemId)}`, { token: token || undefined });
}

export function getDigitalTiers(): Promise<{ tiers: { id: string; price_usd: number; google_play_product_id: string }[]; subscription_products?: string[] }> {
  return apiFetch('/api/digital/tiers');
}

export function verifyDigitalPurchase(token: string, input: { productId: string; purchaseToken: string; itemId?: string }): Promise<{ success: boolean; license_id?: string; item_id?: string; pending?: boolean; error?: string }> {
  return apiFetch('/api/digital/purchase-google-play', {
    method: 'POST', token, body: { product_id: input.productId, purchase_token: input.purchaseToken, item_id: input.itemId },
  });
}

// --- Website card payments (Paystack) - web only --------------------------------

export function startDigitalCheckout(token: string, input: { purpose: 'purchase'; item_id: string; callback_url?: string } | { purpose: 'subscription'; creator_username: string; callback_url?: string }): Promise<{ authorization_url: string; reference: string; amount_ngn: number; price_usd: number }> {
  return apiFetch('/api/digital/paystack-checkout', { method: 'POST', token, body: input });
}

export function verifyDigitalCheckout(token: string, reference: string): Promise<{ success?: boolean; pending?: boolean; refunded?: boolean; error?: string; purpose?: 'purchase' | 'subscription'; license_id?: string | null; subscription_id?: string | null }> {
  return apiFetch('/api/digital/paystack-verify', { method: 'POST', token, body: { reference } });
}

// --- Creator subscriptions ---------------------------------------------------------

export type CreatorPlan = {
  creator_username: string;
  creator_id: string;
  tier_id: string;
  price_usd: number;
  description: string | null;
  items: { item_id: string; kind: DigitalKind; title: string; image: string | null }[];
  google_play_products: string[];
};

export function getCreatorPlan(username: string, token?: string | null): Promise<{ plan: CreatorPlan | null; subscription?: { id: string; provider: string; status: string; current_period_end: string; product_id: string | null } | null; is_creator?: boolean }> {
  return apiFetch(`/api/digital/creator-plan?username=${encodeURIComponent(username)}`, { token: token || undefined });
}

export type OwnCreatorPlan = {
  plan: { creator_username: string; tier_id: string; description: string | null; is_active: boolean } | null;
  tiers: { id: string; price_usd: number }[];
  subscribers: number;
  items: { item_id: string; kind: DigitalKind; title: string }[];
};

export function getOwnCreatorPlan(token: string): Promise<OwnCreatorPlan> {
  return apiFetch('/api/digital/creator-plan?mine=1', { token });
}

export function saveCreatorPlan(token: string, input: { tier_id: string; description?: string; is_active: boolean }): Promise<{ renewals_stopped: number }> {
  return apiFetch('/api/digital/creator-plan', { method: 'POST', token, body: input });
}

export type CreatorSubscription = {
  id: string;
  creator_username: string;
  provider: 'google_play' | 'paystack' | 'admin_grant';
  price_usd: number;
  status: 'active' | 'past_due' | 'expired' | 'revoked';
  has_access: boolean;
  auto_renew: boolean;
  current_period_end: string;
  can_cancel: boolean;
  can_resume: boolean;
  renewal_problem: string | null;
  end_reason: string | null;
  manage_url: string | null;
  product_id: string | null;
};

export function changeSubscription(token: string, subscriptionId: string, action: 'cancel' | 'resume'): Promise<{ success: boolean; access_until: string }> {
  return apiFetch('/api/digital/subscriptions', { method: 'POST', token, body: { subscription_id: subscriptionId, action } });
}

export function verifyCreatorSubscription(token: string, input: { productId: string; purchaseToken: string; creatorUsername?: string }): Promise<{ success: boolean; pending?: boolean; subscription_id?: string; creator_username?: string; error?: string }> {
  return apiFetch('/api/digital/subscribe-google-play', {
    method: 'POST', token, body: { product_id: input.productId, purchase_token: input.purchaseToken, creator_username: input.creatorUsername },
  });
}

// --- Library ---------------------------------------------------------------

export type LibraryItem = {
  license_id: string;
  item_id: string;
  status: 'active' | 'refunded' | 'revoked';
  kind: DigitalKind;
  title: string;
  image: string | null;
  seller_username: string;
  is_paid: boolean;
  price_usd: number | null;
  order_id: string | null;
  created_at: string;
  revoke_reason: string | null;
};

export type SubscriptionLibraryItem = { item_id: string; kind: DigitalKind; title: string; image: string | null; seller_username: string; access_until: string | null };

/** Library route id of an item opened through a subscription (vs a licence id). */
export const subscriptionEntryId = (itemId: string) => `s_${itemId}`;
export const parseLibraryEntryId = (id: string) => (id.startsWith('s_') ? { itemId: id.slice(2), licenseId: null } : { itemId: null, licenseId: id });

export function getLibrary(token: string): Promise<{ offline_days: number; max_devices: number; items: LibraryItem[]; subscriptions?: CreatorSubscription[]; subscription_items?: SubscriptionLibraryItem[] }> {
  return apiFetch('/api/digital/library', { token });
}

export type DigitalFileAccess = {
  id: string;
  kind: DigitalAssetKind;
  title: string | null;
  position: number;
  format: string;
  bytes: number;
  pages: number | null;
  duration_seconds: number | null;
  access:
    | { type: 'pages'; pages: string[] }
    | { type: 'epub'; url: string; format: 'epub'; expires_in_seconds: number; watermark: string }
    | { type: 'audio' | 'video'; url: string; format: string; expires_in_seconds: number };
};

export type LicenseAccess = {
  license_id: string | null;
  item_id: string;
  via: 'purchase' | 'subscription';
  devices_used: number;
  max_devices: number;
  offline_until: string;
  /** Base64 AES-256 key for this licence on this device (null if offline keys are unavailable). */
  offline_key: string | null;
  files: DigitalFileAccess[];
};

/** Opens an owned item (licence id) or a subscription item (`s_<itemId>`). */
export function openLibraryEntry(token: string, entryId: string, deviceId: string): Promise<LicenseAccess> {
  const { itemId, licenseId } = parseLibraryEntryId(entryId);
  return apiFetch('/api/digital/access', { method: 'POST', token, body: licenseId ? { license_id: licenseId, device_id: deviceId } : { item_id: itemId, device_id: deviceId } });
}

// --- Seller ------------------------------------------------------------------

export type SellerDigitalState = {
  listing: { id: string; title: string; status: string; listing_type?: string };
  product: { kind: DigitalKind; tier_id: string; preview_pages: number; preview_seconds: number; rights_confirmed: boolean; in_subscription?: boolean; status: DigitalProduct['status']; review_note: string | null } | null;
  assets: { id: string; kind: DigitalAssetKind; title: string | null; position: number; format: string; bytes: number; pages: number | null; duration_seconds: number | null; status: string }[];
  tiers: { id: string; price_usd: number }[];
  active_licenses: number;
};

export function getSellerDigital(token: string, itemId: string): Promise<SellerDigitalState> {
  return apiFetch(`/api/digital/seller?item_id=${encodeURIComponent(itemId)}`, { token });
}

export function saveSellerDigital(token: string, input: { item_id: string; kind?: DigitalKind; tier_id?: string; preview_pages?: number; preview_seconds?: number; rights_confirmed?: boolean; in_subscription?: boolean }) {
  return apiFetch('/api/digital/seller', { method: 'POST', token, body: input });
}

export function submitSellerDigital(token: string, itemId: string): Promise<{ status: string }> {
  return apiFetch('/api/digital/seller', { method: 'POST', token, body: { item_id: itemId, action: 'submit' } });
}

export function deleteDigitalFile(token: string, id: string) {
  return apiFetch(`/api/digital/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

/** Signed upload straight to Cloudinary (private), then server verification. */
export async function uploadDigitalFile(
  token: string,
  input: { itemId: string; assetKind: DigitalAssetKind; title?: string; file: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null } },
) {
  const signed = await apiFetch<{ upload_url: string; api_key: string; signature: string; allowed_formats: string; folder: string; public_id: string; timestamp: number; type: string; max_bytes: number }>(
    '/api/digital/upload-sign', { method: 'POST', token, body: { asset_kind: input.assetKind } },
  );
  if (input.file.size && input.file.size > signed.max_bytes) {
    throw new ApiError(`File must be under ${Math.round(signed.max_bytes / 1024 / 1024)} MB`, 400, null);
  }
  const form = new FormData();
  form.append('file', { uri: input.file.uri, name: input.file.name || 'file', type: input.file.mimeType || 'application/octet-stream' } as never);
  for (const key of ['api_key', 'signature', 'allowed_formats', 'folder', 'public_id', 'timestamp', 'type'] as const) form.append(key, String(signed[key]));
  const response = await fetch(signed.upload_url, { method: 'POST', body: form });
  const uploaded = await response.json().catch(() => ({})) as { public_id?: string; error?: { message?: string } };
  if (!response.ok || !uploaded.public_id) throw new ApiError(uploaded.error?.message || 'Upload failed', response.status, uploaded);
  return apiFetch('/api/digital/assets', {
    method: 'POST', token, body: { item_id: input.itemId, public_id: uploaded.public_id, asset_kind: input.assetKind, title: input.title },
  });
}

export type DigitalEarnings = {
  currency: 'USD';
  store_fee_percent: number;
  commission_percent: number;
  hold_hours: number;
  sales: number;
  gross_usd: number;
  store_fees_usd: number;
  commission_usd: number;
  pending_usd: number;
  cleared_usd: number;
  paid_out_usd: number;
  reversed_usd: number;
  recent: { id: string; item_id: string | null; source?: 'purchase' | 'subscription'; gross_usd: number; store_fee_usd: number; commission_usd: number; net_usd: number; state: 'pending' | 'cleared' | 'reversed' | 'paid_out'; clears_at: string; reversal_reason: string | null; created_at: string }[];
};

export function getDigitalEarnings(token: string): Promise<DigitalEarnings> {
  return apiFetch('/api/digital/earnings', { token });
}
