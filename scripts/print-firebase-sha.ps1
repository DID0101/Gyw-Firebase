# Print SHA-1/SHA-256 for Firebase Console → Project settings → com.gyw1.chat
$ErrorActionPreference = "Stop"
$androidDir = Join-Path (Join-Path $PSScriptRoot "..") "android"

Write-Host "`n=== Firebase SHA fingerprints (add ALL to Firebase Console) ===`n"
Push-Location $androidDir
try {
  $out = & .\gradlew :app:signingReport 2>&1 | Out-String
  $sha1 = [regex]::Matches($out, 'SHA1:\s*([0-9A-F:]+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
  $sha256 = [regex]::Matches($out, 'SHA-256:\s*([0-9A-F:]+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique

  Write-Host "Debug / local build (Variant: debug):"
  foreach ($s in $sha1) { Write-Host "  SHA-1:   $s" }
  foreach ($s in $sha256) { Write-Host "  SHA-256: $s" }

  Write-Host "`nFirebase Console:"
  Write-Host "  https://console.firebase.google.com/project/gyw1-146d7/settings/general"
  Write-Host "  → Your apps → com.gyw1.chat → Add fingerprint (SHA-1 AND SHA-256)"
  Write-Host "  → Download new google-services.json → replace android/app/google-services.json"
  Write-Host "`nGoogle Cloud APIs (project gyw1-146d7):"
  Write-Host "  Enable: Play Integrity API, Identity Toolkit API, Android Device Verification API"
} finally {
  Pop-Location
}
