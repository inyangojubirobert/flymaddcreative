// Tells admins about a new withdrawal request: a support_messages entry
// (linked to the withdrawal, so it shows in the admin inbox thread) plus the
// usual admin phone alert. Never blocks the request if alerting fails.

import { notifyAdminOfSupportMessage } from './notifyAdminSupport';

export async function alertAdminsOfWithdrawal(supabase, { participant, withdrawalId, amountUsd, source, method }) {
  try {
    const label = source === 'marketplace' ? 'marketplace earnings' : 'vote rewards';
    const body = `Withdrawal request: $${Number(amountUsd).toFixed(2)} from ${label} via ${method}. Please review it in Withdrawals.`;
    const { data: message, error } = await supabase
      .from('support_messages')
      .insert({
        participant_id: participant.id,
        withdrawal_id: withdrawalId,
        sender_type: 'participant',
        message_type: 'enquiry',
        body,
      })
      .select('id')
      .single();
    if (error) throw error;
    await notifyAdminOfSupportMessage(supabase, {
      messageId: message.id,
      participantId: participant.id,
      senderName: participant.name || participant.username,
      title: 'New Withdrawal Request',
      body: `@${participant.username} requested $${Number(amountUsd).toFixed(2)} (${label}).`,
    });
  } catch (error) {
    console.error('Withdrawal admin alert failed:', error.message || error);
  }
}
