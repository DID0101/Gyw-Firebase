# Verify an Android keystore SHA1 matches Google Play's expected upload certificate.
# Usage:
#   .\scripts\verify-upload-keystore.ps1 -KeystorePath .\android\app\upload.keystore -Alias gyw-upload
param(
  [string]$KeystorePath = "android/app/upload.keystore",
  [string]$Alias = "gyw-upload",
  [string]$StorePassword = "",
  [string]$KeyPassword = ""
)

$ExpectedSha1 = "0F:6E:4A:D7:24:88:D1:34:A7:C4:C5:D3:A5:A8:FA:45:46:AE:48:EC"

if (-not (Test-Path $KeystorePath)) {
  Write-Error "Keystore not found: $KeystorePath"
  exit 1
}

if (-not $StorePassword) {
  $StorePassword = Read-Host "Keystore password" -AsSecureString
  $StorePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($StorePassword)
  )
}
if (-not $KeyPassword) { $KeyPassword = $StorePassword }

$out = keytool -list -v -keystore $KeystorePath -alias $Alias -storepass $StorePassword -keypass $KeyPassword 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error ($out -join "`n")
  exit 1
}

$sha1Line = ($out | Select-String "SHA1:" | Select-Object -First 1).Line
$sha1 = ($sha1Line -replace ".*SHA1:\s*", "").Trim()

Write-Host "Keystore: $KeystorePath"
Write-Host "Alias:    $Alias"
Write-Host "SHA1:     $sha1"
Write-Host "Expected: $ExpectedSha1"

if ($sha1.ToUpper() -eq $ExpectedSha1.ToUpper()) {
  Write-Host "`nOK — matches Play Console upload key." -ForegroundColor Green
  exit 0
}

Write-Host "`nMISMATCH — this keystore will be rejected by Play Console." -ForegroundColor Red
exit 2
