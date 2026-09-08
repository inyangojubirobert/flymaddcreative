-- Allow Bascardo Token AI assistant replies to be stored alongside
-- participant/admin/system messages in support_messages.
alter table support_messages drop constraint if exists support_messages_sender_type_check;
alter table support_messages add constraint support_messages_sender_type_check
  check (sender_type in ('participant', 'admin', 'system', 'ai'));

alter table support_messages drop constraint if exists support_messages_message_type_check;
alter table support_messages add constraint support_messages_message_type_check
  check (message_type in ('general', 'enquiry', 'payout_notification', 'ai_response'));
