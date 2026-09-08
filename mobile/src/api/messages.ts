import { apiFetch } from '../lib/api-client';

export type SupportMessage = {
  id: string;
  withdrawal_id: string | null;
  sender_type: 'participant' | 'admin' | 'system' | 'ai';
  message_type: 'general' | 'enquiry' | 'payout_notification' | 'ai_response';
  body: string;
  read_at: string | null;
  created_at: string;
};

export async function getSupportMessages(token: string): Promise<SupportMessage[]> {
  const data = await apiFetch<{ messages: SupportMessage[] }>('/api/onedream/messages', { token });
  return data.messages || [];
}

export async function sendSupportMessage(token: string, body: string): Promise<SupportMessage> {
  const data = await apiFetch<{ success: boolean; message: SupportMessage }>('/api/onedream/messages', {
    method: 'POST',
    token,
    body: { body },
  });
  return data.message;
}

export async function deleteSupportMessage(token: string, id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(`/api/onedream/messages/${id}`, {
    method: 'DELETE',
    token,
  });
}

export async function askBascardoAI(token: string, question: string): Promise<SupportMessage> {
  const data = await apiFetch<{ success: boolean; message: SupportMessage }>('/api/onedream/ai-assist', {
    method: 'POST',
    token,
    body: { question },
  });
  return data.message;
}
