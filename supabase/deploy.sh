#!/bin/bash

echo "🚀 Deploying One Dream Initiative Edge Functions..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Installing..."
    npm install -g supabase
fi

echo "📡 Deploying Edge Functions..."

# Deploy each function
echo "Deploying test-payment..."
supabase functions deploy test-payment

echo "Deploying process-vote-payment..."
supabase functions deploy process-vote-payment

echo "Deploying stripe-webhook..."
supabase functions deploy stripe-webhook

echo "Deploying crypto-webhook..."
supabase functions deploy crypto-webhook

echo "✅ All functions deployed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Set environment variables in Supabase Dashboard"
echo "2. Test the functions with curl or your frontend"
echo "3. Configure payment provider webhooks"
echo ""
echo "🔗 Function URLs:"
echo "- Test Payment: https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/test-payment"
echo "- Process Vote Payment: https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/process-vote-payment"
echo "- Stripe Webhook: https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/stripe-webhook"
echo "- Crypto Webhook: https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/crypto-webhook"