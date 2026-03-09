# 🔐 Android Keystore Generation Guide

## Option 1: Use EAS Build (Recommended - Easiest)

EAS Build can automatically generate and manage your keystore:

```bash
eas credentials
```

**Steps:**
1. Select platform: **Android**
2. Select credential type: **Keystore**
3. Choose: **Generate new keystore**
4. EAS will:
   - Generate a secure keystore
   - Store it securely on their servers
   - Show you the SHA-1 fingerprint
   - Configure builds automatically

**Then:**
- Copy the SHA-1 fingerprint shown
- Add it to Firebase Console (see below)
- Download updated `google-services.json`

## Option 2: Generate Manually

### Step 1: Generate Keystore

Open your terminal and run:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore gyw-release.keystore -alias gyw-release-key -keyalg RSA -keysize 2048 -validity 9125
```

**You'll be prompted for:**
- **Keystore password:** Enter a strong password (min 6 characters)
- **Re-enter password:** Confirm the password
- **Key password:** Press Enter to use same as keystore (recommended)
- **Your name:** Your name or organization
- **Organizational Unit:** e.g., "Mobile Development"
- **Organization:** e.g., "GYW"
- **City:** Your city
- **State:** Your state/province
- **Country code:** Two-letter code (e.g., US, GB, CA)

**Example:**
```
Enter keystore password: [your-password]
Re-enter new password: [your-password]
What is your first and last name?
  [Unknown]:  GYW
What is the name of your organizational unit?
  [Unknown]:  Mobile Development
What is the name of your organization?
  [Unknown]:  GYW
What is the name of your City or Locality?
  [Unknown]:  New York
What is the name of your State or Province?
  [Unknown]:  NY
What is the two-letter country code for this unit?
  [Unknown]:  US
Is CN=GYW, OU=Mobile Development, O=GYW, L=New York, ST=NY, C=US correct?
  [no]:  yes
```

### Step 2: Extract SHA-1 Fingerprint

After generating, extract the SHA-1:

```bash
keytool -list -v -keystore gyw-release.keystore -alias gyw-release-key
```

Enter your keystore password when prompted.

**Look for this line:**
```
SHA1: XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
```

Copy the entire SHA-1 fingerprint (the part after "SHA1: ").

### Step 3: Add SHA-1 to Firebase Console

1. Go to: https://console.firebase.google.com/project/gyw1-146d7/settings/general
2. Scroll to **"Your apps"** → Find **"com.gyw.chat"** (Android)
3. Click **"Add fingerprint"**
4. Paste your **production SHA-1 fingerprint**
5. Click **"Save"**
6. **Wait 2-3 minutes**
7. Click **"Download google-services.json"**
8. **Replace** the `google-services.json` file in your project root

### Step 4: Configure EAS Build

If you generated manually, upload it to EAS:

```bash
eas credentials
```

**Steps:**
1. Select platform: **Android**
2. Select credential type: **Keystore**
3. Choose: **Upload existing**
4. Upload your `gyw-release.keystore` file
5. Enter:
   - Keystore password
   - Key alias: `gyw-release-key`
   - Key password (if different from keystore)

## Important Notes

### 🔒 Security
- **Keep your keystore safe!** If you lose it, you cannot update your app on Play Store
- **Do NOT commit** `*.keystore` or `*.jks` files to git (already in `.gitignore`)
- Store passwords securely (password manager)
- Consider using EAS managed keystore for better security

### 📋 Current Fingerprints

**Debug Keystore SHA-1** (already in Firebase):
```
5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

**Production Keystore SHA-1** (you'll get this after generating):
```
[Will be shown after generation]
```

### ⚠️ Firebase Configuration

**You need BOTH fingerprints in Firebase:**
- Debug SHA-1: For development/testing
- Production SHA-1: For release builds on Play Store

After adding the production SHA-1, download a **NEW** `google-services.json` that includes both fingerprints.

## Verification

After adding SHA-1 to Firebase and downloading the new `google-services.json`, verify:

```bash
node check-google-services.js
```

It should show multiple OAuth clients (one for debug, one for production).

---

**Recommendation:** Use EAS Build's managed keystore (Option 1) - it's easier and more secure!
