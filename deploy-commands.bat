@echo off
echo.
echo 🔑 STEP 1: Set your access token (replace with your actual token):
echo set SUPABASE_ACCESS_TOKEN=sbp_your_token_here
echo.
echo 🚀 STEP 2: Deploy functions (including NEW Paystack integration):
echo supabase functions deploy test-payment --project-ref pjtuisyvpvoswmcgxsfs
echo supabase functions deploy process-vote-payment --project-ref pjtuisyvpvoswmcgxsfs
echo supabase functions deploy stripe-webhook --project-ref pjtuisyvpvoswmcgxsfs
echo supabase functions deploy crypto-webhook --project-ref pjtuisyvpvoswmcgxsfs
echo supabase functions deploy paystack-webhook --project-ref pjtuisyvpvoswmcgxsfs
echo.
echo 💳 NEW: Paystack integration added for African users!
echo ✅ All 5 payment methods ready to deploy!
echo.
pause