# Google Play subscription notifications on Vercel

The backend notification route is:

```text
https://www.flymaddcreative.online/api/onedream/ai-subscription/google-play-notification
```

## Verified setup status

The local Google service-account key successfully obtained a Google access token.
The public notification and purchase-verification routes both returned HTTP 405
to GET requests, as expected for POST-only handlers. An unsigned test POST to
the notification route returned HTTP 401 with the expected identity error.
After the Vercel environment update and redeploy, a direct test notification
carrying a Google-signed identity token returned HTTP 204. This verifies the
deployed audience and service-account check. It does not verify delivery through
Pub/Sub, Google Play API permissions, or purchase entitlement updates.
The Cloud Shell setup script passed a local Bash syntax check; its cloud
operations have not been executed.

Google returned `SERVICE_DISABLED` for Pub/Sub. The service account's project
permissions check returned none of `serviceusage.services.enable`,
`pubsub.topics.create`, `pubsub.subscriptions.create`, or
`pubsub.topics.setIamPolicy`. A Google Cloud project administrator must complete
resource setup. No Google Cloud resources or IAM policies were changed from this workspace.

The Vercel CLI login was found in its Windows `xdg.data/com.vercel.cli` directory.
Both notification variables were saved and verified in Production. The existing
successful Production source was redeployed as
`dpl_CzPJhu72GToC4MCteo1NdvQkXwVy`; it reached READY and was assigned to
`www.flymaddcreative.online`, `flymaddcreative.online`, and `flymaddcreative.vercel.app`.
The three existing Google credential variables were preserved.

Both notification variables have been added to the root `.env.local`. A successful
local configuration check does not mean Pub/Sub is enabled or delivery is working.

## Vercel environment

Keep the three existing Google API credential variables. These two notification
variables have already been added to the Vercel project's **Production** environment:

```ini
GOOGLE_PLAY_PUBSUB_AUDIENCE=https://www.flymaddcreative.online/api/onedream/ai-subscription/google-play-notification
GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL=flymaddcreative-google-play@project-473bc27d-3cf6-4b56-a17.iam.gserviceaccount.com
```

The service-account address above matches the current local credentials. Use it
as the push-authentication account in Google Cloud. The complete JSON credential
variable is unnecessary when using the three separate Google API variables.

The environment change has been deployed. Future environment edits require a
new deployment too; saving variables alone does not change an existing
deployment. See [Vercel's environment instructions](https://vercel.com/docs/environment-variables/managing-environment-variables).

## Google Cloud setup

Open [Google Cloud Shell for this project](https://console.cloud.google.com/home/dashboard?project=project-473bc27d-3cf6-4b56-a17&cloudshell=true)
using an account with permission to enable APIs, create Pub/Sub resources,
edit this topic's IAM policy, edit the selected service account's IAM policy,
and act as that service account. The runtime service account does not need
project administrator permissions.

Upload `scripts/setup-google-play-pubsub.sh` through Cloud Shell's file menu
and run:

```bash
bash setup-google-play-pubsub.sh
```

The script contains public configuration only and uses your signed-in Cloud
Shell account. It does not need the private key or your `.env.local` file.
It enables the Pub/Sub and IAM APIs, creates the Pub/Sub service identity,
creates the topic, grants Google Play permission to publish to that topic,
grants the Pub/Sub service agent Token Creator on the selected push account,
and creates an authenticated push subscription. Existing resources are reused
and the subscription's configuration is checked before reporting success.
It does not change Vercel, Google Play Console, or Android builds.

These are the corresponding Console settings if configuring manually:

| Setting | Value |
| --- | --- |
| Project | `project-473bc27d-3cf6-4b56-a17` |
| Topic ID | `flymadd-google-play-rtdn` |
| Subscription ID | `flymadd-google-play-rtdn-push` |
| Delivery | Push |
| Push URL | The notification endpoint above |
| Authentication | Enabled |
| Authentication service account | The email above |
| Audience | Exactly the notification endpoint above, with no trailing slash |
| Payload unwrapping | Disabled; the handler expects `message.data` |

On the topic, grant `roles/pubsub.publisher` to
`google-play-developer-notifications@system.gserviceaccount.com`.
On the selected push-auth service account, grant
`roles/iam.serviceAccountTokenCreator` to
`service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com`, replacing
`PROJECT_NUMBER` with the numeric project number. The setup script obtains it.

References: [Google Play RTDN setup](https://developer.android.com/google/play/billing/getting-ready#configure-rtdn)
and [authenticated Pub/Sub push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

## Google Play Console and delivery test

For `com.flymaddcreative.onedream`, open **Monetize > Monetization setup**,
enable real-time developer notifications, and enter:

```text
projects/project-473bc27d-3cf6-4b56-a17/topics/flymadd-google-play-rtdn
```

Choose the subscription notification option and save. Use **Send Test Message**.
Check Vercel request logs for a POST to the notification route returning HTTP 204.
Google Play reporting a successful publish proves only that it reached the topic.
An HTTP 204 from the endpoint confirms that the authenticated test was accepted;
it does not verify purchase entitlement updates. Use a license-tester purchase
and renewal to check those separately.

HTTP 401 means the request did not pass the backend identity check; compare the
audience and service-account email on both sides and confirm the Vercel redeploy.
HTTP 404 means the route is missing from that deployment. HTTP 503 on a real
purchase means the backend has not linked the purchase to a participant yet;
Pub/Sub should retry. An authenticated Play test notification has no purchase
token and returns 204 without changing subscription records.
