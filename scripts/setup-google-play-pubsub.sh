#!/usr/bin/env bash
# Run in Google Cloud Shell as a project administrator. No private key is needed.
# Enables APIs, creates RTDN resources, and adds two resource-scoped IAM bindings.
set -euo pipefail

FLYMADD_PROJECT_ID='project-473bc27d-3cf6-4b56-a17'
FLYMADD_PUSH_EMAIL='flymaddcreative-google-play@project-473bc27d-3cf6-4b56-a17.iam.gserviceaccount.com'
FLYMADD_ENDPOINT='https://www.flymaddcreative.online/api/onedream/ai-subscription/google-play-notification'
FLYMADD_TOPIC_ID='flymadd-google-play-rtdn'
FLYMADD_SUBSCRIPTION_ID='flymadd-google-play-rtdn-push'
FLYMADD_TOPIC="projects/${FLYMADD_PROJECT_ID}/topics/${FLYMADD_TOPIC_ID}"
FLYMADD_SUBSCRIPTION="projects/${FLYMADD_PROJECT_ID}/subscriptions/${FLYMADD_SUBSCRIPTION_ID}"

command -v gcloud >/dev/null
command -v python3 >/dev/null

gcloud services enable pubsub.googleapis.com iam.googleapis.com --project="$FLYMADD_PROJECT_ID"
gcloud beta services identity create --service=pubsub.googleapis.com --project="$FLYMADD_PROJECT_ID"
FLYMADD_PROJECT_NUMBER="$(gcloud projects describe "$FLYMADD_PROJECT_ID" --format='value(projectNumber)')"
if [[ ! "$FLYMADD_PROJECT_NUMBER" =~ ^[0-9]+$ ]]; then
  echo 'Cannot determine the project number. Stop and check your Google Cloud account permissions.' >&2
  exit 1
fi

FLYMADD_EXISTING_TOPIC="$(gcloud pubsub topics list --project="$FLYMADD_PROJECT_ID" \
  --filter="name=${FLYMADD_TOPIC}" --format='value(name)')"
if [[ -z "$FLYMADD_EXISTING_TOPIC" ]]; then
  gcloud pubsub topics create "$FLYMADD_TOPIC_ID" --project="$FLYMADD_PROJECT_ID"
fi

# Let Google Play publish only to this topic.
gcloud pubsub topics add-iam-policy-binding "$FLYMADD_TOPIC_ID" --project="$FLYMADD_PROJECT_ID" \
  --member='serviceAccount:google-play-developer-notifications@system.gserviceaccount.com' \
  --role='roles/pubsub.publisher'

# Let Pub/Sub mint push-auth tokens for the selected account only.
gcloud iam service-accounts add-iam-policy-binding "$FLYMADD_PUSH_EMAIL" \
  --project="$FLYMADD_PROJECT_ID" \
  --member="serviceAccount:service-${FLYMADD_PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role='roles/iam.serviceAccountTokenCreator' --condition=None

FLYMADD_EXISTING_SUBSCRIPTION="$(gcloud pubsub subscriptions list --project="$FLYMADD_PROJECT_ID" \
  --filter="name=${FLYMADD_SUBSCRIPTION}" --format='value(name)')"
if [[ -z "$FLYMADD_EXISTING_SUBSCRIPTION" ]]; then
  # Default wrapped JSON delivery is required by the backend's message.data parser.
  gcloud pubsub subscriptions create "$FLYMADD_SUBSCRIPTION_ID" --project="$FLYMADD_PROJECT_ID" \
    --topic="$FLYMADD_TOPIC" \
    --push-endpoint="$FLYMADD_ENDPOINT" \
    --push-auth-service-account="$FLYMADD_PUSH_EMAIL" \
    --push-auth-token-audience="$FLYMADD_ENDPOINT" \
    --ack-deadline=60
fi

# Verify existing resources too; do not overwrite a different subscription setup.
gcloud pubsub subscriptions describe "$FLYMADD_SUBSCRIPTION_ID" --project="$FLYMADD_PROJECT_ID" \
  --format=json | python3 -c '
import json, sys
subscription = json.load(sys.stdin)
topic, endpoint, email = sys.argv[1:]
push = subscription.get("pushConfig", {})
identity = push.get("oidcToken", {})
matches = (
    subscription.get("topic") == topic
    and push.get("pushEndpoint") == endpoint
    and identity.get("serviceAccountEmail") == email
    and identity.get("audience") == endpoint
    and "noWrapper" not in push
)
if not matches:
    sys.exit("Subscription settings differ. Review its topic, push URL, audience, authentication account, and payload wrapping in Cloud Console.")
print("Verified authenticated Pub/Sub push configuration.")
' "$FLYMADD_TOPIC" "$FLYMADD_ENDPOINT" "$FLYMADD_PUSH_EMAIL"

cat <<EOF

Cloud resources are configured. Finish these dashboard steps:

1. Add these two variables to Vercel Production and redeploy the backend:
GOOGLE_PLAY_PUBSUB_AUDIENCE=${FLYMADD_ENDPOINT}
GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL=${FLYMADD_PUSH_EMAIL}

2. In Google Play Console > your app > Monetize > Monetization setup,
   enable real-time developer notifications with this topic:
${FLYMADD_TOPIC}

3. Save and send a test message. Confirm POST returns HTTP 204 in Vercel logs.
   A successful publish alone does not confirm delivery to the backend.
EOF
