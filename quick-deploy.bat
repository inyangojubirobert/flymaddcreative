@echo off
echo 🚀 One Dream Initiative - Edge Functions Deployment
echo.
echo Due to CLI authentication issues, please use Manual Deployment:
echo.
echo 1. Go to: https://supabase.com/dashboard/project/pjtuisyvpvoswmcgxsfs/functions
echo.
echo 2. Create these functions by copying the code:
echo.
echo 📁 process-vote-payment
echo    Copy from: supabase\functions\process-vote-payment\index.ts
echo.
echo 📁 stripe-webhook  
echo    Copy from: supabase\functions\stripe-webhook\index.ts
echo.
echo 📁 crypto-webhook
echo    Copy from: supabase\functions\crypto-webhook\index.ts
echo.
echo 📁 test-payment
echo    Copy from: supabase\functions\test-payment\index.ts
echo.
echo 3. Set Environment Variables in Settings > Edge Functions:
echo    SUPABASE_URL=https://pjtuisyvpvoswmcgxsfs.supabase.co
echo    SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdHVpc3l2cHZvc3dtY2d4c2ZzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDcwODIwNSwiZXhwIjoyMDQ2Mjg0MjA1fQ.UMwLTYB70zBT7aGzMbr7QZJWf7XfkGkWf6-qcJz3OAg
echo.
echo ✅ All functions are ready with fixed imports!
echo.
pause