// Shapes and helpers shared by the admin screens (Admin tab).

export type Conversation = {
  participant_id: string;
  participant: { id: string; name: string | null; username: string; email: string | null } | null;
  kind: 'support' | 'withdrawal';
  label: string;
  status: 'open' | 'handled';
  waiting: boolean;
  ringing: boolean;
  waiting_since: string | null;
  last_message: { body: string; sender_type: string; created_at: string };
  last_user_message: string;
  reminder_count: number;
};

export const waitedFor = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
