# Firebase Phone Auth Setup for Real Phone Numbers

## 🔐 Your SHA-1 Fingerprints

**Debug (local development):**
```
5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

**Production (EAS Build / Play Store):**
```
6C:5E:D3:63:1C:7B:94:C0:65:02:94:D3:B0:2D:36:B4:A2:47:29:5B
```

Add **both** fingerprints in Firebase Console so phone auth works for debug and release builds.

## ⚠️ CRITICAL: Verify Your Setup First

**Run this verification script:**
```powershell
.\verify-firebase-setup.ps1
```

This will check if your `google-services.json` has OAuth clients (SHA-1 fingerprints).

## 📋 Step-by-Step Setup

### Step 1: Add SHA-1 to Firebase Console

1. Go to [Firebase Console - Project Settings](https://console.firebase.google.com/project/gyw1-146d7/settings/general)
2. Scroll down to **"Your apps"** section
3. Find your Android app: **com.gyw.chat**
4. Click **"Add fingerprint"** button
5. Paste: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
6. Click **"Save"**

### Step 2: Download UPDATED google-services.json ⚠️ CRITICAL

**🚨 CRITICAL:** After adding SHA-1, you MUST download a **NEW** `google-services.json` file!

**The current file has `"oauth_client": []` (EMPTY) - this is why real phone numbers don't work!**

1. Still in Firebase Console → Project settings → Your apps → Android app
2. **WAIT 2-3 MINUTES** after adding SHA-1 for Firebase to process it
3. Click **"Download google-services.json"** button
4. **Open the downloaded file** and verify it contains OAuth client data:
   - Look for `"oauth_client": [...]` 
   - ❌ If it shows `"oauth_client": []` → SHA-1 was NOT added correctly! Go back to Step 1.
   - ✅ If it shows `"oauth_client": [{...}]` → Good! Continue.
5. **Replace** the existing `google-services.json` in your project root with the NEW file

**Quick verification command:**
```powershell
powershell -Command "(Get-Content google-services.json | ConvertFrom-Json).client[0].oauth_client.Count"
```
- If result is `0` → File is still missing SHA-1 data!
- If result is `1` or more → ✅ File is correct!

### Step 3: Enable Phone Authentication

1. Firebase Console → **Authentication** → **Sign-in method**
2. Find **Phone** in the list
3. Click **Phone** → **Enable**
4. Click **Save**

### Step 4: Enable Play Integrity API (For Real Phone Numbers)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project: **gyw1-146d7**
3. Go to **APIs & Services** → **Library**
4. Search for **"Play Integrity API"**
5. Click **Enable**

**Note:** This is required for real phone number authentication on Android.

### Step 5: Rebuild Your App (REQUIRED!)

After adding SHA-1 and updating google-services.json, you MUST rebuild:

```bash
# Clean and rebuild
npx expo prebuild --clean
npx expo run:android
```

**⚠️ CRITICAL:** 
- You MUST rebuild - reloading won't work!
- Use a DEVELOPMENT BUILD - Expo Go doesn't support native Firebase modules
- The APK is at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Step 6: Wait for Propagation

- Wait **5-10 minutes** after adding SHA-1 for Firebase to propagate changes
- Wait **10-15 minutes** after enabling Play Integrity API

## ✅ Verify Setup

After rebuilding, try sending an OTP to a real phone number. 

**If you still get `auth/missing-client-identifier` error:**
1. ✅ Verify `google-services.json` has `oauth_client` array (not empty)
2. ✅ Check Play Integrity API is enabled in Google Cloud Console
3. ✅ Wait 10-15 minutes for Firebase to update
4. ✅ Make sure you rebuilt the app (not just reloaded)
5. ✅ Check Firebase Console → Authentication → Sign-in method → Phone is enabled

## 🐛 Troubleshooting

**Error: `auth/missing-client-identifier`**
- Your `google-services.json` is missing OAuth clients
- Solution: Add SHA-1 → Download NEW google-services.json → Rebuild

**Error: `auth/too-many-requests`**
- Rate limit hit (150 requests/hour per IP)
- Solution: Wait 24-48 hours or use test phone numbers

**Error persists after rebuild**
- Play Integrity API might not be enabled
- Solution: Enable Play Integrity API in Google Cloud Console

npx expo prebuild --clean
