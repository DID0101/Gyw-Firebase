# Generate Android Keystore

## Quick Method (Recommended)

Since you're using EAS Build, the easiest way is to let EAS manage the keystore:

```bash
eas credentials
```

Select:
- Platform: **Android**
- Credential type: **Keystore**
- Option: **Generate new keystore** (or **Upload existing** if you already have one)

EAS will automatically:
- Generate a secure keystore
- Store it securely on their servers
- Extract and display the SHA-1 fingerprint
- Configure your builds automatically

## Manual Method

If you prefer to generate your own keystore manually:

### Step 1: Generate Keystore

**Windows (PowerShell):**
```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore gyw-release.keystore -alias gyw-release-key -keyalg RSA -keysize 2048 -validity 9125
```

**macOS/Linux:**
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore gyw-release.keystore -alias gyw-release-key -keyalg RSA -keysize 2048 -validity 9125
```

You'll be prompted for:
- Keystore password (min 6 characters)
- Key password (can be same as keystore)
- Your name/organization details

### Step 2: Extract SHA-1 Fingerprint

**Windows:**
```powershell
keytool -list -v -keystore gyw-release.keystore -alias gyw-release-key
```

**macOS/Linux:**
```bash
keytool -list -v -keystore gyw-release.keystore -alias gyw-release-key
```

Look for the **SHA1:** line and copy the fingerprint (format: `XX:XX:XX:...`)

### Step 3: Add SHA-1 to Firebase

1. Go to Firebase Console: https://console.firebase.google.com/project/gyw1-146d7/settings/general
2. Scroll to "Your apps" → Find "com.gyw.chat" (Android)
3. Click "Add fingerprint"
4. Paste the SHA-1 fingerprint
5. Click "Save"
6. **Download NEW google-services.json** and replace the existing one

### Step 4: Configure EAS Build

```bash
eas credentials
```

Select:
- Platform: **Android**
- Credential type: **Keystore**
- Option: **Upload existing**
- Upload your `gyw-release.keystore` file
- Enter the keystore password and key alias when prompted

## Security Notes

⚠️ **IMPORTANT:**
- Keep your keystore file safe and secure
- Do NOT commit it to version control (already in `.gitignore`)
- Store passwords securely (password manager)
- **If you lose the keystore, you cannot update your app on Play Store!**
- Consider using EAS's managed keystore for better security

## Current Debug Keystore SHA-1

Your current debug keystore SHA-1 (already added to Firebase):
```
5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

You'll need to add the **production keystore SHA-1** separately to Firebase Console.
