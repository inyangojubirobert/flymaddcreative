# Messages and media schema audit

Audited 2026-09-08 against the current workspace backend and the Supabase endpoint configured by `SUPABASE_URL` in `.env.local`. No remote database writes were performed.

**No column migration is currently needed on the configured database.** All three columns reported missing in the handoff are now exposed by its REST API. The handoff did not identify a project, so this does not establish that another environment or the deployed backend uses this same database.

## Column reconciliation

| Column | Existing code expectation | Read-only live result | Action |
| --- | --- | --- | --- |
| `messages.is_read` | Written by `pages/api/messages/send.ts` and `pages/api/messages/[id]/read.ts`; filtered by `unread-count.ts`; read by `conversations.ts` and typed in `mobile/src/api/messages-p2p.ts`. | Present: boolean, default `false`. | Keep it. Add only if missing in another environment. |
| `media.file_name` | No runtime reference found. `pages/api/media/save.ts` inserts participant ID, Cloudinary URL/public ID, and media type. | Present: varchar(255). | Leave it as it is; no addition or removal needed. |
| `media.file_size` | No runtime reference found. | Present: integer. | Leave it as it is; no addition or removal needed. |

The live REST schema lists these columns:

- `messages`: `id`, `sender_id`, `receiver_id`, `content`, `media_urls`, `created_at`, `updated_at`, `is_read`.
- `media`: `id`, `participant_id`, `cloudinary_url`, `cloudinary_public_id`, `media_type`, `created_at`, `file_name`, `file_size`.

The same metadata confirms `messages.sender_id`, `messages.receiver_id`, and `media.participant_id` reference `participants.id`, and that both tables have `id` primary keys.

Checks used HEAD requests, GET requests with `limit=0`, and the REST OpenAPI schema. No participant, message, or media rows were retrieved. A deliberately nonexistent column returned HTTP 400 / PostgreSQL `42703`, while the three real columns returned HTTP 200, confirming the probes validate column existence.

## Authentication and RLS

[Login](../pages/api/onedream/login.js) checks the password hash stored on `participants` and signs the application's JWT with `{ userId: user.id, email, type: 'onedream' }`. [Registration](../pages/api/onedream/register.js) signs the same identity shape. [verifyToken](../lib/jwtSecret.js) verifies the signature/expiry with `JWT_SECRET` and maps `payload.userId` to `decoded.id` when `payload.id` is absent. That ID becomes `sender_id`, `receiver_id`, or `participant_id` in the P2P message/media routes. There is no ID mapping defect for current participant login tokens. The read-receipt fix now uses the existing `requireParticipant` helper, which resolves the same `userId` against `participants` and checks the token type.

All six routes under `pages/api/messages` and `pages/api/media` create their Supabase client using the backend's `SUPABASE_SERVICE_ROLE_KEY`. [The mobile P2P API](../mobile/src/api/messages-p2p.ts) calls those HTTP endpoints with the application's bearer token; it does not query these tables directly. The mobile anon client is used for catalogue reads. Supabase Auth is not part of this participant login flow.

The handoff reports RLS enabled with no policies on `messages` and `media`, and zero `auth.users`. These catalog/auth facts and the index list were not re-queried during this audit; REST schema metadata does not establish them. The privileged backend access pattern is consistent with that reported RLS setup, with participant authorization enforced in the API. Do not add `auth.uid()` policies or disable RLS to reconcile these tables.

Keep the reported indexes unchanged:

- `idx_messages_sender_id`, `idx_messages_receiver_id`, `idx_messages_created_at`.
- `idx_media_participant_id`, `idx_media_created_at`.
- `messages_pkey`, `media_pkey`.

No query plan or workload evidence was gathered to justify additional indexes. The conversation summary endpoint reads all messages involving the caller, so its performance would need measurement before any indexing or pagination change.

## Separate backend findings

The two requested endpoint fixes are implemented locally. The authentication architecture remains unchanged.

1. **Fixed: recipient authorization for read receipts.** [The PATCH handler](../pages/api/messages/[id]/read.ts) resolves the caller with [the existing `requireParticipant` helper](../lib/participantAuth.js) and filters the update by both message ID and `receiver_id: participant.id`. Senders and unrelated participants cannot change the receipt. Missing messages and messages belonging to someone else both return 404. Invalid, expired, merchant, and removed-participant tokens are rejected before a message query.
2. **Remaining audit finding: other P2P/media routes do not validate participant token type or existence.** They still use the generic `verifyToken`, which accepts any payload with a valid shared-secret signature and an `id` or `userId`. [Merchant login](../pages/api/merchants/login.js) also signs tokens with `JWT_SECRET`, including an `id` and `type: 'merchant'`. Those tokens pass the other routes' authentication gate; write foreign keys are not a substitute for authorization. The read-receipt endpoint now rejects them. Extending the same existing participant helper to the other endpoints is a separate follow-up.
3. **Fixed: conversation response mismatch.** [GET conversation](../pages/api/messages/conversation.ts) now returns `{ messages: [...] }`, which matches [the unchanged mobile helper](../mobile/src/api/messages-p2p.ts). POST still returns `{ message: ... }`. Populated and empty conversation responses are tested through that actual mobile helper.

The currently routed [mobile Messages screen](../mobile/src/app/messages.tsx) calls [the support API helper](../mobile/src/api/messages.ts), which uses `/api/onedream/messages` and the separate `support_messages` table. It does not depend on these three columns. The P2P `MessageScreen` component exists, but no imports of it were found in the routed mobile app. These schema findings alone therefore do not establish a blocker for the current AAB support inbox, or certify overall AAB readiness.

## Prepared changes and validation

- Narrowed [the fallback migration](../supabase/add_messages_media_columns.sql) to `ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false`, followed by the existing REST schema reload notification. It does not touch media, indexes, keys, or RLS.
- Marked [the historical bootstrap SQL](../supabase/messages_and_media_schema.sql) as unsuitable for reconciliation of this existing database. Its table-creation and Supabase Auth policies were not executed.
- The fallback migration is only for another environment that still lacks `is_read`. If used there, existing messages will initially read as unread (`false`); the supplied schema contains no historical read-receipt state to recover. Rerunning it preserves existing read flags.

Live checks were read-only. The fallback SQL passed validation in isolated local PostgreSQL against the supplied starting schema, including repeat execution, data preservation, defaults, foreign keys, indexes, and RLS state.

All 12 route regression tests passed with real JWT verification and isolated database doubles:

```powershell
node --test scripts/test-message-routes.mjs
```

The backend fixes require deployment to affect remote clients. No deployed backend, mobile build, or live database configuration was changed. Subscription/Play readiness findings are recorded in [the payment setup guide](BASCARDO_PAYMENT_SETUP.md).
