import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TRANSITIONS = {
  pending: new Set(['processing', 'claimed', 'rejected']),
  processing: new Set(['claimed', 'rejected'])
};

function cleanString(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;

  const id = String(req.query.id || '');
  const nextStatus = String(req.body?.status || '').toLowerCase();
  if (!id || !nextStatus) return res.status(400).json({ error: 'Withdrawal id and status are required' });

  try {
    const { data: existing, error: existingError } = await supabase
      .from('participant_withdrawals')
      .select('id, username, amount_usd, status')
      .eq('id', id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) return res.status(404).json({ error: 'Withdrawal request not found' });
    if (!TRANSITIONS[existing.status]?.has(nextStatus)) {
      return res.status(409).json({ error: `Cannot change a ${existing.status} withdrawal to ${nextStatus}` });
    }

    const adminNote = cleanString(req.body?.admin_note, 2000) || null;
    const update = { status: nextStatus, admin_note: adminNote };
    let confirmationMessage;

    if (nextStatus === 'claimed') {
      const payoutType = cleanString(req.body?.payout_type, 10).toLowerCase();
      const payoutCurrency = cleanString(req.body?.payout_currency, 12).toUpperCase();
      const payoutNetwork = cleanString(req.body?.payout_network, 50) || null;
      const payoutReference = cleanString(req.body?.payout_reference, 250);
      const payoutAmount = Number(req.body?.payout_amount);

      if (!['fiat', 'crypto'].includes(payoutType)) {
        return res.status(400).json({ error: 'Select fiat or crypto as the payout type' });
      }
      if (!payoutCurrency || !payoutReference || !Number.isFinite(payoutAmount) || payoutAmount <= 0) {
        return res.status(400).json({ error: 'Payout currency, amount, and transaction reference are required to mark as claimed' });
      }
      if (payoutType === 'crypto' && !payoutNetwork) {
        return res.status(400).json({ error: 'A blockchain/network is required for crypto payouts' });
      }

      const now = new Date().toISOString();
      Object.assign(update, {
        payout_type: payoutType,
        payout_currency: payoutCurrency,
        payout_network: payoutNetwork,
        payout_reference: payoutReference,
        payout_amount: payoutAmount,
        payout_confirmed_at: now,
        claimed_at: now,
        claimed_by: admin.id
      });
      confirmationMessage = `Your withdrawal request for $${Number(existing.amount_usd).toFixed(2)} has been confirmed as claimed. Payout: ${payoutType} ${payoutAmount} ${payoutCurrency}${payoutNetwork ? ` on ${payoutNetwork}` : ''}. Reference: ${payoutReference}.`;
    } else if (nextStatus === 'processing') {
      confirmationMessage = `Your withdrawal request for $${Number(existing.amount_usd).toFixed(2)} is now being processed.`;
    } else {
      confirmationMessage = `Your withdrawal request for $${Number(existing.amount_usd).toFixed(2)} was not approved. ${adminNote || 'Please contact support if you have a question.'}`;
    }

    const { data: withdrawal, error: updateError } = await supabase
      .from('participant_withdrawals')
      .update(update)
      .eq('id', existing.id)
      .eq('status', existing.status)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!withdrawal) {
      return res.status(409).json({ error: 'This withdrawal was updated by another administrator. Refresh and try again.' });
    }

    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id')
      .eq('username', existing.username)
      .maybeSingle();

    if (participantError) throw participantError;
    if (participant) {
      const { error: messageError } = await supabase
        .from('support_messages')
        .insert({
          participant_id: participant.id,
          admin_id: admin.id,
          withdrawal_id: existing.id,
          sender_type: 'system',
          message_type: 'payout_notification',
          body: confirmationMessage
        });
      if (messageError) console.error('Unable to create payout notification:', messageError);
    }

    return res.status(200).json({ success: true, withdrawal });
  } catch (error) {
    console.error('Admin withdrawal update error:', error);
    return res.status(500).json({ error: 'Unable to update withdrawal request' });
  }
}
