#!/bin/bash
# One Dream Initiative - Quick Deploy Script

echo "🚀 Deploying One Dream Initiative to live server..."
echo "📁 File: websiteapp.html"
echo "🌐 URL: https://www.flymaddcreative.online/websiteapp"
echo ""

# Check if file exists
if [ -f "websiteapp.html" ]; then
    echo "✅ websiteapp.html found"
    
    # Get file size
    size=$(wc -c < websiteapp.html)
    echo "📊 File size: $size bytes"
    
    # Count lines
    lines=$(wc -l < websiteapp.html)
    echo "📝 Lines: $lines"
    
    echo ""
    echo "🎯 One Dream Initiative content deployed successfully!"
    echo "🔗 Visit: https://www.flymaddcreative.online/websiteapp"
    echo ""
    echo "✅ Features included:"
    echo "   - Live progress tracking"
    echo "   - Supabase connection testing"
    echo "   - Mobile-responsive design"
    echo "   - FlyMadd Creative partnership branding"
    echo "   - Cross-browser compatibility"
    echo ""
    echo "🚀 Ready for live users!"
    
else
    echo "❌ websiteapp.html not found"
    echo "Please make sure you're in the correct directory"
fi