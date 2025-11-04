@echo off
echo.
echo 🚀 One Dream Initiative - Function Deployment Helper
echo ================================================
echo.

echo Step 1: Setting up PATH...
set "PATH=%PATH%;%USERPROFILE%\scoop\shims"

echo Step 2: Checking Supabase CLI...
supabase --version
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Supabase CLI not found. Please install it first.
    pause
    exit /b 1
)

echo.
echo ✅ Supabase CLI found!
echo.
echo Step 3: You need to set your access token first:
echo.
echo 1. Go to: https://supabase.com/dashboard/account/tokens
echo 2. Generate a new token
echo 3. Run this command with your token:
echo.
echo    set SUPABASE_ACCESS_TOKEN=sbp_your_token_here
echo.
echo 4. Then run your deployment commands:
echo.
echo    supabase functions deploy test-payment --project-ref pjtuisyvpvoswmcgxsfs
echo    supabase functions deploy process-vote-payment --project-ref pjtuisyvpvoswmcgxsfs
echo    supabase functions deploy stripe-webhook --project-ref pjtuisyvpvoswmcgxsfs
echo    supabase functions deploy crypto-webhook --project-ref pjtuisyvpvoswmcgxsfs
echo.
echo 📋 Your Functions:
echo    ✅ test-payment (ready)
echo    ✅ process-vote-payment (ready)  
echo    ✅ stripe-webhook (ready)
echo    ✅ crypto-webhook (ready)
echo.
echo 🎯 After deployment, your functions will be available at:
echo    https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/[function-name]
echo.
pause