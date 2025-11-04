# 🚀 Complete Supabase Functions Deployment Guide

## Step 1: Get Your Access Token

### Method A: Via Supabase Dashboard

1. Go to: https://supabase.com/dashboard/account/tokens
2. Click "Generate new token"
3. Give it a name like "CLI Deploy Token"
4. Copy the token (starts with `sbp_`)

### Method B: Via CLI (if login works)

```powershell
# Add Scoop to PATH first
$env:PATH += ";$HOME\scoop\shims"

# Try login (might need manual browser step)
supabase login
```

## Step 2: Set Environment Variable

```powershell
# Replace YOUR_ACCESS_TOKEN with the token from Step 1
$env:SUPABASE_ACCESS_TOKEN = "sbp_your_access_token_here"
```

## Step 3: Deploy Functions

### Deploy All Functions:

```powershell
# Ensure Supabase CLI is in PATH
$env:PATH += ";$HOME\scoop\shims"

# Deploy each function individually
supabase functions deploy test-payment --project-ref pjtuisyvpvoswmcgxsfs
supabase functions deploy process-vote-payment --project-ref pjtuisyvpvoswmcgxsfs
supabase functions deploy stripe-webhook --project-ref pjtuisyvpvoswmcgxsfs
supabase functions deploy crypto-webhook --project-ref pjtuisyvpvoswmcgxsfs
```

### Or Deploy All at Once:

```powershell
supabase functions deploy --project-ref pjtuisyvpvoswmcgxsfs
```

## Step 4: Set Environment Variables in Supabase

After deployment, go to your Supabase Dashboard:

1. Go to: https://supabase.com/dashboard/project/pjtuisyvpvoswmcgxsfs/settings/edge-functions
2. Add these environment variables:

```
SUPABASE_URL=https://pjtuisyvpvoswmcgxsfs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdHVpc3l2cHZvc3dtY2d4c2ZzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDcwODIwNSwiZXhwIjoyMDQ2Mjg0MjA1fQ.UMwLTYB70zBT7aGzMbr7QZJWf7XfkGkWf6-qcJz3OAg
```

## Step 5: Test Your Deployed Functions

### Test Payment Function:

```powershell
# Test the deployed function
curl -X POST "https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/test-payment" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqdHVpc3l2cHZvc3dtY2d4c2ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA3MDgyMDUsImV4cCI6MjA0NjI4NDIwNX0.NW2p8Kxw4FrQB0gJy15CIgHJZkMW3kALHASGdEXqPpE" `
  -d '{
    "username": "testuser123",
    "transaction_id": "test_12345",
    "payment_method": "test",
    "amount": 2.00,
    "payer_email": "test@example.com"
  }'
```

## Step 6: Local Development (Optional)

### Serve Functions Locally:

```powershell
# Add PATH
$env:PATH += ";$HOME\scoop\shims"

# Serve specific function
supabase functions serve test-payment

# Or serve all functions
supabase functions serve
```

Your local function will be available at:

- `http://localhost:54321/functions/v1/test-payment`

## 🛠️ Troubleshooting

### If PATH Issues:

```powershell
# Permanently add to PATH (restart terminal after)
[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$HOME\scoop\shims", "User")
```

### If Token Issues:

1. Make sure token starts with `sbp_`
2. Verify token has correct permissions
3. Try regenerating the token

### If Deployment Fails:

1. Check function syntax with: `supabase functions serve function-name`
2. Verify project-ref is correct: `pjtuisyvpvoswmcgxsfs`
3. Check logs: `supabase functions logs function-name --project-ref pjtuisyvpvoswmcgxsfs`

## 🎯 Your Function URLs (After Deployment):

- **test-payment**: `https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/test-payment`
- **process-vote-payment**: `https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/process-vote-payment`
- **stripe-webhook**: `https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/stripe-webhook`
- **crypto-webhook**: `https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/crypto-webhook`

## ✅ Success Indicators:

After deployment, you should see:

- ✅ Functions listed in Supabase Dashboard → Edge Functions
- ✅ Environment variables set
- ✅ Test requests return valid JSON responses
- ✅ Function logs show successful execution

Ready to deploy! 🚀
