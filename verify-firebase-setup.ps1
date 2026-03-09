# Firebase Phone Auth Setup Verification Script

Write-Host "`n=== FIREBASE PHONE AUTH SETUP VERIFICATION ===" -ForegroundColor Cyan
Write-Host ""

# Check SHA-1 fingerprint
Write-Host "📋 Your SHA-1 Fingerprint:" -ForegroundColor Yellow
Write-Host "5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25" -ForegroundColor Green
Write-Host ""

# Check google-services.json
Write-Host "Checking google-services.json..." -ForegroundColor Yellow
if (Test-Path "google-services.json") {
    try {
        $json = Get-Content "google-services.json" -Raw | ConvertFrom-Json
        $oauthClients = $json.client[0].oauth_client
        
        if ($oauthClients -and $oauthClients.Count -gt 0) {
            Write-Host "✅ google-services.json has OAuth clients (SHA-1 configured)" -ForegroundColor Green
            Write-Host "   Found $($oauthClients.Count) OAuth client(s)" -ForegroundColor Gray
            Write-Host "   ✅ Real phone numbers should work!" -ForegroundColor Green
        } else {
            Write-Host "❌ CRITICAL: google-services.json MISSING OAuth clients!" -ForegroundColor Red
            Write-Host "   Current file shows: 'oauth_client': [] (EMPTY)" -ForegroundColor Red
            Write-Host "   Required: 'oauth_client': [{...}] (with SHA-1 data)" -ForegroundColor Red
            Write-Host ""
            Write-Host "🔧 FIX REQUIRED (DO ALL STEPS):" -ForegroundColor Yellow
            Write-Host "   1. Go to Firebase Console:" -ForegroundColor White
            Write-Host "      https://console.firebase.google.com/project/gyw1-146d7/settings/general" -ForegroundColor Cyan
            Write-Host "   2. Scroll to 'Your apps' → Find 'com.gyw.chat' (Android)" -ForegroundColor White
            Write-Host "   3. Click 'Add fingerprint'" -ForegroundColor White
            Write-Host "   4. Paste: 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25" -ForegroundColor White
            Write-Host "   5. Click 'Save'" -ForegroundColor White
            Write-Host "   6. ⚠️  WAIT 2-3 MINUTES for Firebase to process" -ForegroundColor Yellow
            Write-Host "   7. ⚠️  Click 'Download google-services.json' (MUST download NEW file!)" -ForegroundColor Yellow
            Write-Host "   8. Open downloaded file and verify 'oauth_client': [{...}] is NOT empty" -ForegroundColor White
            Write-Host "   9. Replace google-services.json in project root" -ForegroundColor White
            Write-Host "   10. Run: npx expo prebuild --clean && npx expo run:android" -ForegroundColor White
            Write-Host ""
            Write-Host "   ⚠️  If downloaded file still has empty oauth_client, SHA-1 wasn't added correctly!" -ForegroundColor Red
        }
    } catch {
        Write-Host "❌ Error reading google-services.json: $_" -ForegroundColor Red
    }
} else {
    Write-Host "❌ google-services.json not found in project root!" -ForegroundColor Red
    Write-Host "   Download it from Firebase Console" -ForegroundColor Yellow
}

Write-Host ""

# Check android/app/google-services.json
Write-Host "Checking android/app/google-services.json..." -ForegroundColor Yellow
if (Test-Path "android\app\google-services.json") {
    Write-Host "✅ File exists in android/app/" -ForegroundColor Green
} else {
    Write-Host "⚠️  File missing in android/app/ (will be copied during build)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== NEXT STEPS ===" -ForegroundColor Cyan
Write-Host "1. Add SHA-1 to Firebase Console (if not done)" -ForegroundColor White
Write-Host "2. Download UPDATED google-services.json" -ForegroundColor White
Write-Host "3. Replace google-services.json in project root" -ForegroundColor White
Write-Host "4. Rebuild: npx expo prebuild --clean && npx expo run:android" -ForegroundColor White
Write-Host "5. Wait 5-10 minutes for Firebase to propagate changes" -ForegroundColor White
Write-Host ""

