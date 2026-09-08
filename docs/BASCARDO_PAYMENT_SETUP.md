# Bascardo AI and native shop rollout

## Implementation status

Web checkout uses Paystack monthly subscriptions. Android uses Google Play
Billing and sends purchase tokens to the backend for verification. The native
screen also supports restoring purchases. Payment provider responses drive
the stored AI entitlement; a client success screen alone does not activate it.

Local code does not establish which revision is deployed to the production
website. The read-only checks below confirm route availability, but real
purchases/renewals have not been tested in this audit. Building an APK/AAB
does not deploy its API or database changes.

## Readiness checked on September 8, 2026

`node scripts/check-google-play-readiness.mjs --remote` passed for the
workspace's configured environment:

- Required Supabase, Google credential, and Pub/Sub variables are present;
  the configured private key parses as RSA. This does not verify Google permissions.
- Empty reads of `ai_subscriptions`, `ai_subscription_transactions`, and
  `ai_provider_subscriptions` succeed for the columns the checker requests.
- `get_ai_subscription_entitlement` responds to the read-only probe with an
  all-zero participant ID. No real participant data is requested.
- The configured site's `google-play` and `google-play-notification` routes
  reject GET with HTTP 405, as expected. This does not verify the deployed
  implementation version, server credentials, or authenticated purchase handling.

All 34 existing subscription/currency tests also passed locally:

```powershell
node --experimental-vm-modules --test scripts/test-google-play-subscriptions.mjs scripts/test-ai-subscription-currency.mjs
```

No missing subscription table was found by these probes; they do not prove
every migration or database function matches the current source. Do not run
table-creation SQL based only on an older handoff. The provider state migration
is `supabase/add_ai_provider_subscriptions.sql`, after the base AI schema and
`supabase/add_ai_subscription_payments.sql`, if that migration is still needed
in the target environment.

Both Expo configuration and native Gradle source specify version 1.0.7 (9).
The native project, signing files, and an AAB output are present locally;
the output's embedded version, signature, and freshness were not reverified
in this audit. No new AAB was built or uploaded.

Remaining release verification: confirm the deployed backend revision,
Play products/base plans and service-account permissions, authenticated RTDN
test delivery, and a license-tester purchase/restore through a verified AAB
on an internal or closed test track. No live database writes, deployments,
purchases, or Play Console changes were performed by this audit.

## Database

Apply `supabase/add_ai_subscription_payments.sql` if the existing AI schema
has already been installed. For an installation without the AI tables, use
`supabase/create_ai_business_assistant.sql`, which includes payment storage.

Apply `supabase/add_catalogue_product_details.sql` to add `size` and
`promo_video_url` to existing catalogue items. These migrations have not been
applied to the live database. The new product fields also require deployment
of `pages/api/catalogue/items.js`; an older API may ignore them.

## Server environment

Keep every payment secret on the server, never in EXPO_PUBLIC variables or
the APK. Existing participant authentication and Supabase environment
configuration are also required.

| Variable | Purpose |
| --- | --- |
| `PAYSTACK_SECRET_KEY` | Server-side Paystack initialization and verification |
| `NEXT_PUBLIC_SITE_URL` | Public site origin for the web return URL |
| `PAYSTACK_AI_PRO_PLAN_CODE` | Optional existing plan, reused only if its monthly NGN amount matches the current converted quote |
| `PAYSTACK_AI_BUSINESS_PLAN_CODE` | Optional existing plan, reused only if its monthly NGN amount matches the current converted quote |
| `GOOGLE_PROJECT_ID` | Google Cloud project ID; use with the email and private key below |
| `GOOGLE_CLIENT_EMAIL` | Google Play service-account email |
| `GOOGLE_PRIVATE_KEY` | Service-account PEM private key; supports escaped `\n` or actual line breaks |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Alternative Android Publisher service-account JSON secret, used when the three separate variables are unset |
| `GOOGLE_PLAY_PACKAGE_NAME` | Defaults to `com.flymaddcreative.onedream` |
| `GOOGLE_PLAY_AI_PRO_PRODUCT_ID` | Defaults to `bascardo_ai_pro_monthly` |
| `GOOGLE_PLAY_AI_BUSINESS_PRODUCT_ID` | Defaults to `bascardo_ai_business_monthly` |
| `GOOGLE_PLAY_PUBSUB_AUDIENCE` | Exact audience configured on the authenticated Pub/Sub push |
| `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Expected push identity email |

For local backend development, put the three Google credential variables in
the repository root `.env.local`, which is ignored by Git. For example:

```ini
GOOGLE_PROJECT_ID=your_project_id
GOOGLE_CLIENT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"
GOOGLE_PLAY_PACKAGE_NAME=com.flymaddcreative.onedream
```

Replace every placeholder locally. If any separate credential variable is set,
all three are required and take precedence over `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
Restart the local backend after editing its environment. For production, set
the same variables in the Vercel backend project's Production environment and
redeploy the backend; local `.env.local` changes do not configure Vercel.
Never put these credentials in `mobile/.env.local` or public environment variables.
Run `npm run check:google-play` to check local configuration without displaying
credentials; it does not verify Google API access or make purchases.

AI checkout now uses the existing `lib/currency.js` converter, also used by
catalogue payments. It uses the shared live/cached USD-to-NGN rate and the
shared kobo rounding helper. `AI_SUBSCRIPTION_NGN_PER_USD` is no longer read
and can be removed from server configuration. The converter's existing
last-resort 1600 fallback remains only when both live and cached rates are
unavailable; there is no separate subscription exchange rate.

New checkouts reuse or create a monthly NGN plan matching the converted quote.
An old configured plan at a different price is not updated: existing users
keep the monthly NGN amount they agreed to. Each new checkout saves its plan
code, account, currency, and amount in the existing payment table before a
checkout URL is returned. The exchange rate is also included in the server's
Paystack metadata. Verification and renewals use that saved amount, not a
fresh currency conversion or client-supplied amount.

This follows Paystack's [plan amount model](https://paystack.com/docs/api/plan/)
and [subscription event lifecycle](https://paystack.com/docs/payments/subscriptions/).

Deploy checkout, verification, and webhook changes together. The payment table
must exist before checkout can start; this change needs no additional columns.
Use test credentials to verify the flow first. Android Google Play prices are
still managed by Google Play and are unaffected by this web checkout change.

## Provider setup

Paystack AI webhook endpoint:
`/api/onedream/ai-subscription/paystack-webhook`

Do not replace an existing goods/votes webhook blindly. The AI handler is
separate from the existing payment handler; preserve existing event delivery
through the account's deployment/routing arrangement before enabling it.

Create and activate the two Google Play subscriptions and monthly base plans
using the product IDs above. Grant the backend service account the required
Play permissions to verify and acknowledge purchases. Configure authenticated
Pub/Sub push delivery to:
`/api/onedream/ai-subscription/google-play-notification`

The push audience and identity must match the server variables. Purchase
verification endpoint:
`/api/onedream/ai-subscription/google-play`

See [the Vercel Pub/Sub setup guide](GOOGLE_PLAY_PUBSUB_SETUP.md) for the exact
notification URL, push identity, Cloud Shell setup script, and delivery test.

The original signing key has been recovered and both artifacts signed; the
device is on 1.0.6 (8). See `mobile/ANDROID_RELEASE.md` for verification details.
Use a Play test track and license testers to verify
purchase, pending payment, restoration, renewal, cancellation, expiry, and
refund behavior before enabling paid access for users.

## Checks completed locally

Mobile TypeScript and focused ESLint passed. Both Android release targets
compiled. Next.js production build passed, with a pre-existing warning in
`pages/api/register-participant.js` about the missing `getReferralLink` export.
Database/provider/live-device payment tests remain pending the setup above.

Currency and subscription regression checks (nine tests, all passing):

```powershell
node --experimental-vm-modules --test scripts/test-ai-subscription-currency.mjs
```

These use isolated provider/database doubles and make no real charges. They
cover shared conversion, saved quotes, rate changes after checkout, plan
price differences, storage errors, rejected mismatched payments, renewal
pricing, and duplicate events. The production build also passed after the
currency integration, with the same pre-existing warning noted above.
