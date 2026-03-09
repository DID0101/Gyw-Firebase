# 🚨 QUICK FIX: Missing SHA-1 in google-services.json

## Current Problem

Your `google-services.json` file shows:
```json
"oauth_client": []
```

**This is EMPTY** - it needs SHA-1 fingerprint data!

## ✅ Fix in 5 Steps

### 1️⃣ Open Firebase Console
👉 https://console.firebase.google.com/project/gyw1-146d7/settings/general

### 2️⃣ Add SHA-1 Fingerprint
- Scroll to **"Your apps"** → Find **"com.gyw.chat"** (Android)
- Click **"Add fingerprint"**
- Paste: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- Click **"Save"**

### 3️⃣ WAIT 2-3 Minutes ⏱️
Firebase needs time to process the SHA-1 fingerprint.

### 4️⃣ Download NEW File
- Still in Firebase Console → Your apps → Android app
- Click **"Download google-services.json"**
- **OPEN the downloaded file** and verify it has:
  - ✅ `"oauth_client": [{...}]` (with data inside)
  - ❌ NOT `"oauth_client": []` (empty)

### 5️⃣ Replace & Rebuild
```bash
# Replace google-services.json in project root with the NEW file
# Then rebuild:
npx expo prebuild --clean
npx expo run:android
```

## Verify Fix

Run this command:
```bash
node check-google-services.js
```

- ✅ If it says "SHA-1 data present" → Good!
- ❌ If it says "MISSING SHA-1 DATA" → Repeat steps above

## Why This Happens

The `google-services.json` file is a **snapshot** of your Firebase configuration. When you add SHA-1 to Firebase Console, the file doesn't automatically update - you MUST download a new one!

---

**After fixing this, wait 5-10 minutes, then test with a real phone number.**
