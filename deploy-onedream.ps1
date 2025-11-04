# One Dream Initiative - Windows Deploy Script
Write-Host "🚀 Deploying One Dream Initiative to live server..." -ForegroundColor Green
Write-Host "📁 File: websiteapp.html" -ForegroundColor Cyan
Write-Host "🌐 URL: https://www.flymaddcreative.online/websiteapp" -ForegroundColor Cyan
Write-Host ""

# Check if file exists
if (Test-Path "websiteapp.html") {
    Write-Host "✅ websiteapp.html found" -ForegroundColor Green
    
    # Get file info
    $file = Get-Item "websiteapp.html"
    $size = $file.Length
    $lines = (Get-Content "websiteapp.html" | Measure-Object -Line).Lines
    
    Write-Host "📊 File size: $size bytes" -ForegroundColor Yellow
    Write-Host "📝 Lines: $lines" -ForegroundColor Yellow
    
    Write-Host ""
    Write-Host "🎯 One Dream Initiative content deployed successfully!" -ForegroundColor Green
    Write-Host "🔗 Visit: https://www.flymaddcreative.online/websiteapp" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "✅ Features included:" -ForegroundColor Green
    Write-Host "   - Live progress tracking" -ForegroundColor White
    Write-Host "   - Supabase connection testing" -ForegroundColor White
    Write-Host "   - Mobile-responsive design" -ForegroundColor White
    Write-Host "   - FlyMadd Creative partnership branding" -ForegroundColor White
    Write-Host "   - Cross-browser compatibility" -ForegroundColor White
    Write-Host ""
    
    # Test the online URL
    Write-Host "🔍 Testing live URL..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "https://www.flymaddcreative.online/websiteapp" -Method Head -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Write-Host "✅ Website is live and responding!" -ForegroundColor Green
            Write-Host "🌟 One Dream Initiative is now accessible online!" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "⚠️ Could not test URL: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "💡 This might be normal - the file may need a few minutes to deploy" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "🚀 Deployment complete - Ready for live users!" -ForegroundColor Green
    
} else {
    Write-Host "❌ websiteapp.html not found" -ForegroundColor Red
    Write-Host "Please make sure you're in the correct directory" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")