# Print debug/release SHA-1 for Firebase Console — compare to google-services.json (com.gyw1.chat)
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "android"
if (-not (Test-Path $android)) {
  Write-Host "android/ not found. Run: npx expo prebuild" -ForegroundColor Yellow
  exit 1
}
Push-Location $android
try {
  .\gradlew.bat :app:signingReport
} finally {
  Pop-Location
}
Write-Host ""
Write-Host "Add Variant:debug SHA-1 to Firebase Console -> Project settings -> com.gyw1.chat -> SHA certificate fingerprints"
Write-Host "Then download fresh google-services.json and rebuild."
