# Google Play Upload Key Reset Guide

This guide walks you through resetting your upload key in Google Play Console and updating Firebase.

## Current Situation

| Fingerprint | Description |
|-------------|-------------|
| **AF:1F:A1:FB:BE:82:38:4A:44:44:25:EB:0B:78:A1:44:F1:17:7C:E9** | Original key (expected by Play Store) — **LOST** |
| **0F:6E:4A:D7:24:80:D1:34:A7:C4:C5:03:A5:A0:FA:45:46:AE:40:EC** | Current key (used by EAS) — **WRONG** |

Your project uses **Expo EAS Build** — there is no local `build.gradle` or `android/` folder. Signing is managed by EAS credentials.

---

## Step 1: Choose Your New Keystore

You have two options:

### Option A: Use the existing EAS keystore (0F:6E:4A...)

If you want to keep using the keystore EAS already has:

1. Run: `eas credentials`
2. Select **Android** → **production**
3. Go to **Keystore** → **Download** (or similar)
4. Save the keystore file (e.g. as `gyw-release.keystore`)
5. Note the keystore password (you set it when creating credentials in EAS)

### Option B: Generate a brand new keystore

Run the existing script:

```powershell
.\generate-keystore.ps1
```

This creates `gyw-release.keystore` with alias `gyw-release-key`. **Store the password securely.**

---

## Step 2: Export the PEM Certificate for Google Play

Use this `keytool` command to export the public certificate in PEM format:

```powershell
keytool -exportcert -alias gyw-release-key -keystore gyw-release.keystore -rfc -file upload_certificate.pem
```

- **`gyw-release-key`** — alias (matches your `generate-keystore.ps1`)
- **`gyw-release.keystore`** — path to your keystore (use full path if not in current directory)
- **`upload_certificate.pem`** — output file to submit to Google

You will be prompted for the keystore password.

**Verify the PEM fingerprint** (optional):

```powershell
keytool -list -v -keystore gyw-release.keystore -alias gyw-release-key
```

Check that the SHA1 fingerprint matches the key you intend to use (e.g. 0F:6E:4A... for Option A).

---

## Step 3: Request Upload Key Reset in Google Play Console

1. Go to [Google Play Console](https://play.google.com/console/)
2. Select your app
3. **Release** → **Setup** → **App integrity**
4. Find **Upload key certificate**
5. Click **Request upload key reset**
6. Attach `upload_certificate.pem`
7. Explain that you lost access to the original upload key
8. Submit the request

Google usually responds within **24–48 hours** (sometimes 2–3 business days). You cannot upload new builds until the new key is approved.

---

## Step 4: Configure EAS to Use the New Keystore (After Approval)

Once Google approves the reset:

1. Run: `eas credentials`
2. Select **Android** → **production**
3. Go to **Keystore**
4. Choose **Upload existing keystore**
5. Provide `gyw-release.keystore`, alias `gyw-release-key`, and passwords

EAS will use this keystore for future production builds.

---

## Step 5: Update Firebase with New SHA-1 and SHA-256

**Yes, you need to update Firebase.** The `google-services.json` includes `certificate_hash` (SHA-1) for Google Sign-In and other services. These must match your signing key.

### Get your new fingerprints

```powershell
keytool -list -v -keystore gyw-release.keystore -alias gyw-release-key
```

Note the **SHA1** and **SHA256** values.

### Add them in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project **gyw1-146d7**
3. **Project settings** (gear icon)
4. Under **Your apps**, select the Android app (`com.gyw1.chat`)
5. Click **Add fingerprint**
6. Add the **SHA-1** fingerprint
7. Add the **SHA-256** fingerprint (if not already present)
8. Click **Save**

### Download and replace `google-services.json`

1. In the same Firebase app settings, click **Download google-services.json**
2. Replace the existing `google-services.json` in your project root

Your current `google-services.json` has these certificate hashes:

- `5e8f16062ea3cd2c4a0d547876baa6f38cabf625` (debug)
- `6c5ed3631c7b94c0650294d3b02d36b4a247295b`

Neither matches your production fingerprint. After adding the new SHA-1/SHA-256 in Firebase and downloading the new file, the new hashes will be included.

---

## Summary Checklist

- [ ] Obtain keystore (download from EAS or generate new)
- [ ] Export PEM: `keytool -exportcert -alias gyw-release-key -keystore gyw-release.keystore -rfc -file upload_certificate.pem`
- [ ] Submit `upload_certificate.pem` to Google Play (Request upload key reset)
- [ ] Wait for Google approval
- [ ] Configure EAS credentials with the keystore
- [ ] Add new SHA-1 and SHA-256 to Firebase Console
- [ ] Download and replace `google-services.json`
- [ ] Build and upload a new AAB: `eas build --platform android --profile production`
