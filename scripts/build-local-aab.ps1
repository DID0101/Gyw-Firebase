# Build a Play-ready AAB locally with the EAS upload keystore.
# Usage:
#   node scripts/fetch-eas-android-keystore.cjs   # once, requires eas login
#   powershell -ExecutionPolicy Bypass -File scripts/build-local-aab.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$keystore = Join-Path $Root 'android\app\upload.keystore'
$props = Join-Path $Root 'android\keystore.properties'

if (-not (Test-Path $keystore) -or -not (Test-Path $props)) {
  Write-Host 'Missing upload keystore. Fetching from EAS...' -ForegroundColor Yellow
  node (Join-Path $Root 'scripts\fetch-eas-android-keystore.cjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Verifying upload keystore SHA1...' -ForegroundColor Cyan
try {
  $alias = (Get-Content $props | Where-Object { $_ -match '^MYAPP_UPLOAD_KEY_ALIAS=' }) -replace 'MYAPP_UPLOAD_KEY_ALIAS=', ''
  $storePass = (Get-Content $props | Where-Object { $_ -match '^MYAPP_UPLOAD_STORE_PASSWORD=' }) -replace 'MYAPP_UPLOAD_STORE_PASSWORD=', ''
  $keyPass = (Get-Content $props | Where-Object { $_ -match '^MYAPP_UPLOAD_KEY_PASSWORD=' }) -replace 'MYAPP_UPLOAD_KEY_PASSWORD=', ''
  $keytoolOut = cmd /c "keytool -list -v -keystore `"$keystore`" -alias $alias -storepass $storePass -keypass $keyPass 2>&1"
  ($keytoolOut | Select-String 'SHA1:') | ForEach-Object { Write-Host $_.Line }
} catch {
  Write-Host 'Keystore verify skipped (keytool warning)' -ForegroundColor Yellow
}

$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
Write-Host 'Running Gradle bundleRelease (embeds JS via Expo export:embed)...' -ForegroundColor Cyan
Set-Location (Join-Path $Root 'android')
.\gradlew.bat :app:bundleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$aab = Join-Path $Root 'android\app\build\outputs\bundle\release\app-release.aab'
if (Test-Path $aab) {
  $dest = Join-Path $Root 'gyw-release.aab'
  Copy-Item $aab $dest -Force
  Write-Host "`nAAB ready:" -ForegroundColor Green
  Write-Host "  $aab"
  Write-Host "  $dest"
} else {
  Write-Error 'bundleRelease finished but AAB not found'
}
