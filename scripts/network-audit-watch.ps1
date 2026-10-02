# Dev helper — run the app and filter Network Audit logs in Metro output.
# Usage (from repo root):
#   .\scripts\network-audit-watch.ps1
#
# Or manually:
#   npx expo start
#   Then in Metro, filter console with: NET_AUDIT

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "Starting Expo dev server — filter Metro logs with: NET_AUDIT" -ForegroundColor Cyan
Write-Host "Manual full report in device JS console: global.__GYW_AUDIT_REPORT()" -ForegroundColor Cyan
Write-Host "Docs: docs/NETWORK_AUDIT_TOOLKIT.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "Idle test protocol:" -ForegroundColor Yellow
Write-Host "  1. Open app, sign in, go to Chats tab"
Write-Host "  2. Do NOT open any chat — wait 5 minutes"
Write-Host "  3. Check for LISTENER_LEAK_SUSPECT, FIRESTORE_RECONNECT_STORM, HIGH_FREQUENCY_PRESENCE"
Write-Host "  4. Run global.__GYW_AUDIT_REPORT() via React Native debugger"
Write-Host ""

Set-Location $Root
npx expo start
