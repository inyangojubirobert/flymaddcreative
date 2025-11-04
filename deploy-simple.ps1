# One Dream Initiative - PowerShell Deployment Script

Write-Host "🚀 One Dream Initiative - Function Deployment" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Add Scoop to PATH for this session
$env:PATH += ";$HOME\scoop\shims"

Write-Host "Step 1: Checking Supabase CLI..." -ForegroundColor Yellow
try {
    $version = supabase --version
    Write-Host "✅ Supabase CLI found! Version: $version" -ForegroundColor Green
} catch {
    Write-Host "❌ Supabase CLI not found. Please install it first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Access Token Setup" -ForegroundColor Yellow
Write-Host "You need to set your access token first:"
Write-Host ""
Write-Host "1. Go to: https://supabase.com/dashboard/account/tokens"
Write-Host "2. Generate a new token (starts with 'sbp_')"
Write-Host "3. Copy the token and run:"
Write-Host ""
Write-Host "`$env:SUPABASE_ACCESS_TOKEN = 'sbp_your_token_here'" -ForegroundColor Yellow
Write-Host ""

Write-Host "Step 3: Deployment Commands" -ForegroundColor Yellow
Write-Host "After setting the token, run these commands:"
Write-Host ""
Write-Host "supabase functions deploy test-payment --project-ref pjtuisyvpvoswmcgxsfs" -ForegroundColor White
Write-Host "supabase functions deploy process-vote-payment --project-ref pjtuisyvpvoswmcgxsfs" -ForegroundColor White
Write-Host "supabase functions deploy stripe-webhook --project-ref pjtuisyvpvoswmcgxsfs" -ForegroundColor White
Write-Host "supabase functions deploy crypto-webhook --project-ref pjtuisyvpvoswmcgxsfs" -ForegroundColor White
Write-Host ""

Write-Host "Your Functions Status:" -ForegroundColor Yellow
$functions = @("test-payment", "process-vote-payment", "stripe-webhook", "crypto-webhook")
foreach ($func in $functions) {
    $path = "supabase\functions\$func\index.ts"
    if (Test-Path $path) {
        Write-Host "   ✅ $func (ready)" -ForegroundColor Green
    } else {
        Write-Host "   ❌ $func (missing)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "After deployment, functions will be available at:" -ForegroundColor Yellow
Write-Host "https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/[function-name]" -ForegroundColor Green
Write-Host ""
Write-Host "This PowerShell session now has Supabase CLI in PATH!" -ForegroundColor Magenta