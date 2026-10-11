// Sends one phone alert after a participant message is saved in support_messages.
// Admin replies, AI replies, payout notices, and user-to-user messages do not come through here.
// Withdrawal requests also use it (with their own title/body) so admins get a phone alert.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function senderLabel(name) {
  const label = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return label || 'Someone';
}

export async function notifyAdminOfSupportMessage(supabase, { messageId, participantId, senderName, title, body }) {
  if (!messageId) return;

  const { error: claimError } = await supabase
    .from('admin_push_deliveries')
    .insert({ message_id: messageId });

  if (claimError) {
    if (claimError.code === '23505') return;
    console.error('Admin push claim failed:', claimError);
    return;
  }

  const { data: devices, error: deviceError } = await supabase
    .from('admin_push_devices')
    .select('id, expo_push_token')
    .eq('is_active', true);

  if (deviceError) {
    console.error('Admin push device lookup failed:', deviceError);
    await supabase.from('admin_push_deliveries').delete().eq('message_id', messageId);
    return;
  }

  const tokens = (devices || []).map((device) => device.expo_push_token).filter(Boolean);
  if (!tokens.length) return;

  const label = senderLabel(senderName);
  const messages = tokens.map((token) => ({
    to: token,
    title: title || 'New Support Message',
    body: body || `${label} sent you a message.`,
    sound: 'default',
    priority: 'high',
    channelId: 'admin-support',
    data: {
      type: 'admin_support',
      messageId,
      participantId: participantId || null,
    },
  }));

  try {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Expo push failed:', response.status, payload);
      await supabase.from('admin_push_deliveries').delete().eq('message_id', messageId);
      return;
    }

    const tickets = Array.isArray(payload.data) ? payload.data : [];
    const expired = tickets
      .map((ticket, index) => (ticket?.details?.error === 'DeviceNotRegistered' ? tokens[index] : null))
      .filter(Boolean);
    if (expired.length) {
      await supabase
        .from('admin_push_devices')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('expo_push_token', expired);
    }
  } catch (error) {
    console.error('Admin push send failed:', error);
    await supabase.from('admin_push_deliveries').delete().eq('message_id', messageId);
  }
}
