// Admin inbox for the app's Admin tab: one conversation per participant.
//   GET  ?status=open|handled|all       conversations + counts
//   POST { participant_id, action: 'handled' | 'open' | 'ack' }
//        handled: answered, stop ringing; open: reopen; ack: "Checked" (stops
//        ringing until the participant writes again)
// Reading and replying use /api/admin/messages.

import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../lib/adminAuth';
import { isMissingSchema, loadConversations, setConversationState } from '../../../lib/adminInbox';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const UUID = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const status = ['open', 'handled', 'all'].includes(req.query.status) ? req.query.status : 'open';
      const all = await loadConversations(supabase);
      const list = status === 'all' ? all : all.filter((c) => c.status === status);
      if (status === 'open') list.sort((a, b) => new Date(a.waiting_since) - new Date(b.waiting_since));
      return res.status(200).json({
        conversations: list.slice(0, 200),
        counts: {
          open: all.filter((c) => c.status === 'open').length,
          waiting: all.filter((c) => c.waiting).length,
          ringing: all.filter((c) => c.ringing).length,
        },
      });
    }
    if (req.method === 'POST') {
      const participantId = String(req.body?.participant_id || '');
      const action = req.body?.action;
      if (!UUID.test(participantId) || !['handled', 'open', 'ack'].includes(action)) {
        return res.status(400).json({ error: 'participant_id and action (handled, open or ack) are required' });
      }
      const now = new Date().toISOString();
      await setConversationState(supabase, participantId,
        action === 'handled' ? { handled_at: now, handled_by: admin.id, ack_at: now, ack_by: admin.id }
          : action === 'ack' ? { ack_at: now, ack_by: admin.id }
            : { handled_at: null, handled_by: null });
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (isMissingSchema(error)) return res.status(503).json({ error: 'Run supabase/add_admin_app_and_alarm.sql first' });
    console.error('admin/inbox error:', error.message || error);
    return res.status(500).json({ error: 'Inbox failed' });
  }
}
