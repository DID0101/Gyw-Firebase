# PowerShell script to set environment variables in EAS
# TODO: Update this script for Firebase configuration

Write-Host "Setting environment variables in EAS..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Please replace the placeholder values with your actual Firebase keys:" -ForegroundColor Yellow
Write-Host "1. Get Firebase config from: https://console.firebase.google.com" -ForegroundColor Yellow
Write-Host ""
Write-Host "Then run these commands one by one:" -ForegroundColor Cyan
Write-Host ""
Write-Host 'eas secret:create --scope project --name EXPO_PUBLIC_FIREBASE_API_KEY --value "your_firebase_api_key_here" --type string'
Write-Host ""
Write-Host "After setting all variables, verify with:" -ForegroundColor Cyan
Write-Host "eas secret:list"
Write-Host ""
Write-Host "Then rebuild with:" -ForegroundColor Cyan
Write-Host "eas build --platform android --profile production"

