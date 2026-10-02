# Full Firebase Analytics checklist on device (dev client + deep link).
$ErrorActionPreference = "Continue"

$MetroUrl = "http%3A%2F%2F127.0.0.1%3A8081"
$DevClientUri = "exp+gyw://expo-development-client/?url=$MetroUrl"

adb shell setprop debug.firebase.analytics.app com.gyw1.chat | Out-Null
adb shell setprop log.tag.FA VERBOSE | Out-Null
adb shell setprop log.tag.FA-SVC VERBOSE | Out-Null
adb reverse tcp:8081 tcp:8081 | Out-Null
adb logcat -c | Out-Null

adb shell am force-stop com.gyw1.chat | Out-Null
Start-Sleep -Seconds 2

Write-Host "Opening dev client via Metro deep link..."
adb shell am start -a android.intent.action.VIEW -d $DevClientUri -n com.gyw1.chat/.MainActivity | Out-Null

Write-Host "Waiting for JS bundle (poll up to 120s)..."
$bundleReady = $false
for ($i = 0; $i -lt 24; $i++) {
  Start-Sleep -Seconds 5
  $hit = adb logcat -d -t 80 | Select-String -Pattern "origin=app,name=app_open"
  if ($hit) {
    $bundleReady = $true
    Write-Host "Bundle loaded (app_open seen in logcat)."
    break
  }
}
if (-not $bundleReady) {
  Write-Host "WARN: app_open not seen yet; continuing anyway."
}

Write-Host "Firing analytics checklist via gyw:// deep link..."
adb shell am start -a android.intent.action.VIEW -d "gyw://analytics-checklist" -n com.gyw1.chat/.MainActivity | Out-Null
Start-Sleep -Seconds 8

Write-Host "`n=== Analytics events (origin=app) ==="
$lines = adb logcat -d | Select-String -Pattern "origin=app,name="
$events = $lines | ForEach-Object {
  if ($_.Line -match "name=([^,]+)") { $matches[1] }
} | Sort-Object -Unique

$hasImageSent = ($lines | Where-Object { $_.Line -match "name=message_sent" -and $_.Line -match "type=image" }).Count -gt 0

$expected = @(
  @{ Name = 'app_open';        Ok = $events -contains 'app_open' },
  @{ Name = 'app_opened';      Ok = $events -contains 'app_opened' },
  @{ Name = 'login';           Ok = $events -contains 'login' },
  @{ Name = 'sign_up';         Ok = $events -contains 'sign_up' },
  @{ Name = 'chat_opened';     Ok = $events -contains 'chat_opened' },
  @{ Name = 'chat_created';    Ok = $events -contains 'chat_created' },
  @{ Name = 'group_created';   Ok = $events -contains 'group_created' },
  @{ Name = 'message_sent';    Ok = $events -contains 'message_sent' },
  @{ Name = 'image_sent';      Ok = $hasImageSent; Note = '(logged as message_sent type=image)' },
  @{ Name = 'voice_message_sent'; Ok = $events -contains 'voice_message_sent' },
  @{ Name = 'voice_call_started';   Ok = $events -contains 'voice_call_started' },
  @{ Name = 'video_call_started';   Ok = $events -contains 'video_call_started' },
  @{ Name = 'profile_viewed';       Ok = $events -contains 'profile_viewed' },
  @{ Name = 'logout';               Ok = $events -contains 'logout' }
)

$pass = ($expected | Where-Object { $_.Ok }).Count
$total = $expected.Count
Write-Host ("Result: {0}/{1} passed`n" -f $pass, $total)

foreach ($e in $expected) {
  $mark = if ($e.Ok) { "PASS" } else { "MISS" }
  $suffix = if ($e.Note) { " $($e.Note)" } else { "" }
  Write-Host ("[{0}] {1}{2}" -f $mark, $e.Name, $suffix)
}

Write-Host "`nRaw logcat matches:"
$lines | Select-Object -Last 35 | ForEach-Object { $_.Line }
