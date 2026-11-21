// The Admin tab in the app. An admin signs into the app with their normal
// participant account; if that account is linked to an active admin
// (admin_users.participant_id, supabase/add_admin_app_and_alarm.sql), this
// returns an admin token for the admin screens. Everyone else gets
// { is_admin: false } and never sees the tab.
//   GET (participant Bearer token) -> { is_admin, token?, admin? }

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import { createAdminToken } from '../../../lib/adminAuth';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  res.setHeader('Cache-Control', 'no-store');
  const { data: admin, error } = await supabase.from('admin_users')
    .select('id, email, display_name, is_active')
    .eq('participant_id', participant.id).eq('is_active', true).maybeSingle();
  if (error) {
    if (error.code !== '42703') console.error('admin app-session:', error.message);
    return res.status(200).json({ is_admin: false }); // column missing before the SQL runs
  }
  if (!admin) return res.status(200).json({ is_admin: false });
  return res.status(200).json({
    is_admin: true,
    token: createAdminToken(admin),
    admin: { id: admin.id, email: admin.email, display_name: admin.display_name },
  });
}
