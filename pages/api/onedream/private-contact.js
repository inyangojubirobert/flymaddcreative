// The signed-in participant's private contact (phone / WhatsApp), used by
// admins and for order follow-through when they sell. Never exposed through
// public profile, listing or search APIs.

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const clean = (value) => (typeof value === 'string' ? value.trim().slice(0, 40) : '');
const digits = (value) => value.replace(/\D/g, '').length;

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('participant_private_contacts')
        .select('phone, whatsapp, updated_at')
        .eq('participant_id', participant.id)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({ contact: data || null });
    }

    const phone = clean(req.body?.phone);
    const whatsapp = clean(req.body?.whatsapp) || phone;
    if (digits(phone) < 7) return res.status(400).json({ error: 'Enter a valid phone number' });
    if (digits(whatsapp) < 7) return res.status(400).json({ error: 'Enter a valid WhatsApp number' });

    const { data, error } = await supabase
      .from('participant_private_contacts')
      .upsert({ participant_id: participant.id, phone, whatsapp, updated_at: new Date().toISOString() }, { onConflict: 'participant_id' })
      .select('phone, whatsapp, updated_at')
      .single();
    if (error) throw error;
    return res.status(200).json({ contact: data });
  } catch (error) {
    console.error('private-contact error:', error);
    return res.status(500).json({ error: 'Could not save your contact' });
  }
}
