# Build debug APK for USB install (short path via subst to avoid Windows MAX_PATH in Gradle transforms).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Corrupt transform cache (metadata.bin) — safe to ignore if already deleted.
try {
  cmd /c "rmdir /s /q \\?\C:\Users\dpurl\.gradle\caches\8.13\transforms\55adfb62865e8fffcca71de16ae1ff0a" 2>nul
} catch { }
cmd /c "subst X: /D" 2>$null
cmd /c "subst X: `"$Root`""

Set-Location X:\android
$env:SENTRY_DISABLE_AUTO_UPLOAD = 'true'
.\gradlew.bat --stop 2>$null
.\gradlew.bat :app:assembleDebug -x lint -x test --no-daemon --no-build-cache -PreactNativeArchitectures=arm64-v8a
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = 'X:\android\app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) {
  Write-Error "Debug APK not found at $apk"
}

Write-Host "`nDebug APK ready:" -ForegroundColor Green
Write-Host "  $apk"

$devices = (adb devices | Select-String 'device$' | ForEach-Object { ($_ -split '\s+')[0] })
if ($devices.Count -eq 0) {
  Write-Host "`nNo phone detected. Connect USB + enable USB debugging, then run:" -ForegroundColor Yellow
  Write-Host "  adb install -r `"$apk`""
  Write-Host "  cd `"$Root`" && npx expo start"
  exit 0
}

foreach ($id in $devices) {
  Write-Host "Installing on $id ..." -ForegroundColor Cyan
  adb -s $id install -r $apk
}

Set-Location $Root
node (Join-Path $Root 'scripts\android-usb-reverse.cjs')
Write-Host "`nNext: run Metro and open the app on your phone:" -ForegroundColor Cyan
Write-Host "  cd `"$Root`""
Write-Host "  npx expo start"
Write-Host "Test sign-in with your phone number (e.g. +905526055202)." -ForegroundColor Cyan
