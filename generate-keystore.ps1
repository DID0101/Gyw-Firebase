# Android Keystore Generation Script
# This generates a production keystore for signing Android apps

Write-Host "`n=== Android Keystore Generator ===" -ForegroundColor Cyan
Write-Host ""

# Keystore configuration
$KEYSTORE_NAME = "gyw-release.keystore"
$KEYSTORE_ALIAS = "gyw-release-key"
$KEYSTORE_PASSWORD = ""
$KEY_ALIAS = "gyw-release-key"
$KEY_PASSWORD = ""
$VALIDITY_YEARS = 25

# Get keystore password
Write-Host "Enter a password for the keystore (min 6 characters):" -ForegroundColor Yellow
$KEYSTORE_PASSWORD = Read-Host -AsSecureString
$KEYSTORE_PASSWORD_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($KEYSTORE_PASSWORD))

if ($KEYSTORE_PASSWORD_PLAIN.Length -lt 6) {
    Write-Host "❌ Password must be at least 6 characters!" -ForegroundColor Red
    exit 1
}

# Get key password (can be same as keystore password)
Write-Host "`nEnter a password for the key (press Enter to use same as keystore):" -ForegroundColor Yellow
$KEY_PASSWORD_INPUT = Read-Host -AsSecureString
if ($KEY_PASSWORD_INPUT.Length -eq 0) {
    $KEY_PASSWORD_PLAIN = $KEYSTORE_PASSWORD_PLAIN
} else {
    $KEY_PASSWORD_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($KEY_PASSWORD_INPUT))
}

# Get organization details
Write-Host "`nEnter your organization details (for certificate):" -ForegroundColor Yellow
$CN = Read-Host "Organization Name (CN) [GYW]"
if ([string]::IsNullOrWhiteSpace($CN)) { $CN = "GYW" }

$OU = Read-Host "Organizational Unit (OU) [Mobile Development]"
if ([string]::IsNullOrWhiteSpace($OU)) { $OU = "Mobile Development" }

$O = Read-Host "Organization (O) [GYW]"
if ([string]::IsNullOrWhiteSpace($O)) { $O = "GYW" }

$L = Read-Host "City/Locality (L) []"
$ST = Read-Host "State/Province (ST) []"
$C = Read-Host "Country Code (C) [US]"
if ([string]::IsNullOrWhiteSpace($C)) { $C = "US" }

# Build distinguished name
$DNAME = "CN=$CN, OU=$OU, O=$O"
if ($L) { $DNAME += ", L=$L" }
if ($ST) { $DNAME += ", ST=$ST" }
$DNAME += ", C=$C"

Write-Host "`nGenerating keystore..." -ForegroundColor Cyan

# Generate keystore
$keytoolPath = "keytool"
try {
    $keytoolCheck = Get-Command keytool -ErrorAction Stop
} catch {
    Write-Host "❌ keytool not found! Make sure Java JDK is installed and in PATH." -ForegroundColor Red
    Write-Host "   Install Java JDK from: https://adoptium.net/" -ForegroundColor Yellow
    exit 1
}

# Check if keystore already exists
if (Test-Path $KEYSTORE_NAME) {
    Write-Host "⚠️  Keystore file already exists: $KEYSTORE_NAME" -ForegroundColor Yellow
    $overwrite = Read-Host "Overwrite? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
    Remove-Item $KEYSTORE_NAME -Force
}

# Generate keystore command
$keytoolArgs = @(
    "-genkeypair",
    "-v",
    "-storetype", "PKCS12",
    "-keystore", $KEYSTORE_NAME,
    "-alias", $KEY_ALIAS,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", ($VALIDITY_YEARS * 365)
)

# Run keytool with password input
$process = Start-Process -FilePath "keytool" -ArgumentList $keytoolArgs -NoNewWindow -Wait -PassThru -RedirectStandardInput "input.txt" -RedirectStandardOutput "output.txt" -RedirectStandardError "error.txt"

# Create input file with passwords and DN
$inputContent = "$KEYSTORE_PASSWORD_PLAIN`n$KEY_PASSWORD_PLAIN`n$KEY_PASSWORD_PLAIN`n$DNAME`ny`n"
$inputContent | Out-File -FilePath "input.txt" -Encoding ASCII -NoNewline

# Run keytool
$process = Start-Process -FilePath "keytool" -ArgumentList $keytoolArgs -NoNewWindow -Wait -PassThru

if ($process.ExitCode -eq 0 -and (Test-Path $KEYSTORE_NAME)) {
    Write-Host "✅ Keystore generated successfully: $KEYSTORE_NAME" -ForegroundColor Green
    Write-Host ""
    
    # Extract SHA-1 fingerprint
    Write-Host "Extracting SHA-1 fingerprint..." -ForegroundColor Cyan
    $sha1Output = & keytool -list -v -keystore $KEYSTORE_NAME -alias $KEY_ALIAS -storepass $KEYSTORE_PASSWORD_PLAIN 2>&1
    $sha1Match = $sha1Output | Select-String -Pattern "SHA1:\s*([A-F0-9:]+)" | ForEach-Object { $_.Matches.Groups[1].Value }
    
    if ($sha1Match) {
        Write-Host "`n📋 SHA-1 Fingerprint:" -ForegroundColor Yellow
        Write-Host $sha1Match -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  IMPORTANT: Add this SHA-1 to Firebase Console!" -ForegroundColor Yellow
        Write-Host "   1. Go to Firebase Console → Project Settings → Your apps → Android" -ForegroundColor White
        Write-Host "   2. Click 'Add fingerprint'" -ForegroundColor White
        Write-Host "   3. Paste: $sha1Match" -ForegroundColor White
        Write-Host "   4. Download NEW google-services.json" -ForegroundColor White
        Write-Host ""
    }
    
    # Extract SHA-256 fingerprint
    $sha256Match = $sha1Output | Select-String -Pattern "SHA256:\s*([A-F0-9:]+)" | ForEach-Object { $_.Matches.Groups[1].Value }
    if ($sha256Match) {
        Write-Host "📋 SHA-256 Fingerprint:" -ForegroundColor Yellow
        Write-Host $sha256Match -ForegroundColor Green
        Write-Host ""
    }
    
    Write-Host "=== Keystore Information ===" -ForegroundColor Cyan
    Write-Host "Keystore file: $KEYSTORE_NAME" -ForegroundColor White
    Write-Host "Alias: $KEY_ALIAS" -ForegroundColor White
    Write-Host "Validity: $VALIDITY_YEARS years" -ForegroundColor White
    Write-Host ""
    Write-Host "⚠️  SECURITY WARNING:" -ForegroundColor Red
    Write-Host "   - Keep this keystore file safe and secure!" -ForegroundColor Yellow
    Write-Host "   - Do NOT commit it to version control (already in .gitignore)" -ForegroundColor Yellow
    Write-Host "   - Store passwords securely (consider using a password manager)" -ForegroundColor Yellow
    Write-Host "   - If lost, you cannot update your app on Play Store!" -ForegroundColor Red
    Write-Host ""
    Write-Host "=== Next Steps ===" -ForegroundColor Cyan
    Write-Host "1. Add SHA-1 fingerprint to Firebase Console" -ForegroundColor White
    Write-Host "2. Download updated google-services.json" -ForegroundColor White
    Write-Host "3. Configure EAS Build with keystore:" -ForegroundColor White
    Write-Host "   eas credentials" -ForegroundColor Cyan
    Write-Host "   (Select Android, then Keystore, then Upload existing)" -ForegroundColor Gray
    Write-Host ""
    
} else {
    Write-Host "❌ Failed to generate keystore!" -ForegroundColor Red
    if (Test-Path "error.txt") {
        Write-Host "Error details:" -ForegroundColor Yellow
        Get-Content "error.txt"
    }
    exit 1
}

# Cleanup temp files
if (Test-Path "input.txt") { Remove-Item "input.txt" -ErrorAction SilentlyContinue }
if (Test-Path "output.txt") { Remove-Item "output.txt" -ErrorAction SilentlyContinue }
if (Test-Path "error.txt") { Remove-Item "error.txt" -ErrorAction SilentlyContinue }
