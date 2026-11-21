// Messages still ringing for an admin (the app's full-screen alarm polls this).
//   GET -> { alarms: [{ participant_id, label, participant, last_user_message, waiting_since, reminder_count }] }
// Check one off with POST /api/admin/inbox { participant_id, action: 'ack' }.

import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../lib/adminAuth';
import { isMissingSchema, loadConversations } from '../../../lib/adminInbox';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ringing = (await loadConversations(supabase)).filter((c) => c.ringing)
      .sort((a, b) => new Date(a.waiting_since) - new Date(b.waiting_since)).slice(0, 20);
    return res.status(200).json({ alarms: ringing });
  } catch (error) {
    if (isMissingSchema(error)) return res.status(200).json({ alarms: [] }); // before the SQL runs
    console.error('admin/alarm error:', error.message || error);
    return res.status(500).json({ error: 'Alarm check failed' });
  }
}
