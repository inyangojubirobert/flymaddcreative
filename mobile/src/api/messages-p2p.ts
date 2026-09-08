import { apiFetch } from '../lib/api-client';

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  media_urls?: string[];
  is_read: boolean;
  created_at: string;
  updated_at: string;
};

export type MessageInput = {
  receiver_id: string;
  content: string;
  media_urls?: string[];
};

/**
 * Fetch messages between two participants
 * @param token JWT token
 * @param receiverId ID of the other participant
 * @returns Array of messages
 */
export async function getConversation(token: string, receiverId: string): Promise<Message[]> {
  const data = await apiFetch<{ messages: Message[] }>('/api/messages/conversation', {
    method: 'GET',
    token,
    headers: { 'X-Receiver-Id': receiverId },
  });
  return data.messages || [];
}

/**
 * Send a message with optional media
 * @param token JWT token
 * @param message Message content and recipient
 * @returns Created message
 */
export async function sendMessage(token: string, message: MessageInput): Promise<Message> {
  const data = await apiFetch<{ message: Message }>('/api/messages/send', {
    method: 'POST',
    token,
    body: message,
  });
  return data.message;
}

/**
 * Mark a message as read
 * @param token JWT token
 * @param messageId ID of the message
 * @returns Updated message
 */
export async function markMessageAsRead(token: string, messageId: string): Promise<Message> {
  const data = await apiFetch<{ message: Message }>(`/api/messages/${messageId}/read`, {
    method: 'PATCH',
    token,
  });
  return data.message;
}

/**
 * Get unread message count
 * @param token JWT token
 * @returns Count of unread messages
 */
export async function getUnreadCount(token: string): Promise<number> {
  const data = await apiFetch<{ count: number }>('/api/messages/unread-count', {
    method: 'GET',
    token,
  });
  return data.count || 0;
}

/**
 * Get list of recent conversations
 * @param token JWT token
 * @returns Array of conversation summaries
 */
export async function getConversations(token: string): Promise<any[]> {
  const data = await apiFetch<{ conversations: any[] }>('/api/messages/conversations', {
    method: 'GET',
    token,
  });
  return data.conversations || [];
}

/**
 * Upload media and return URLs for storage
 * @param token JWT token
 * @param cloudinaryUrls URLs from Cloudinary
 * @returns Media records created in database
 */
export async function saveMediaRecords(
  token: string,
  cloudinaryUrls: string[]
): Promise<any[]> {
  const data = await apiFetch<{ media: any[] }>('/api/media/save', {
    method: 'POST',
    token,
    body: { urls: cloudinaryUrls },
  });
  return data.media || [];
}
