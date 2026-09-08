import { apiFetch } from '../lib/api-client';

export type OrderMessage = {
  id: string;
  sender_role: 'buyer' | 'seller';
  body: string;
  media_url: string | null;
  created_at: string;
};

type AuthInput = { token?: string; buyer_token?: string };

export async function getOrderMessages(orderId: string, auth: AuthInput): Promise<OrderMessage[]> {
  const qs = auth.buyer_token ? `&buyer_token=${encodeURIComponent(auth.buyer_token)}` : '';
  const data = await apiFetch<{ messages: OrderMessage[] }>(`/api/catalogue/order-messages?order_id=${orderId}${qs}`, {
    token: auth.token,
  });
  return data.messages || [];
}

export async function sendOrderMessage(
  orderId: string,
  auth: AuthInput,
  body: string,
  mediaUrl?: string | null
): Promise<OrderMessage> {
  const data = await apiFetch<{ success: boolean; message: OrderMessage }>('/api/catalogue/order-messages', {
    method: 'POST',
    token: auth.token,
    body: { order_id: orderId, buyer_token: auth.buyer_token, body, media_url: mediaUrl || null },
  });
  return data.message;
}

export async function deleteOrderMessage(orderId: string, messageId: string, auth: AuthInput): Promise<void> {
  const qs = auth.buyer_token ? `&buyer_token=${encodeURIComponent(auth.buyer_token)}` : '';
  await apiFetch<{ success: boolean }>(`/api/catalogue/order-messages?order_id=${orderId}&id=${messageId}${qs}`, {
    method: 'DELETE',
    token: auth.token,
  });
}
