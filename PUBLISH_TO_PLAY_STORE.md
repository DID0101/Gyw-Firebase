# Publish GYW to Google Play Store – Step-by-Step

## Before You Start

- [ ] **Google Play Developer account** – [Register](https://play.google.com/console/signup) ($25 one-time)
- [ ] **Expo account** – [Sign up](https://expo.dev/signup)
- [ ] **EAS CLI** – Run: `npm install -g eas-cli` then `eas login`

---

## Step 1: Build the Production AAB

```bash
eas build --platform android --profile production
```

- Build runs on Expo servers (~15–20 min)
- If asked about credentials, choose **Generate new keystore** (EAS will manage it)
- After build completes, download the AAB from the [EAS dashboard](https://expo.dev) or note the build ID

---

## Step 2: Add Production SHA-1 to Firebase

1. Run: `eas credentials` → Android → Keystore
2. Copy the **SHA-1 fingerprint** shown
3. Go to [Firebase Console](https://console.firebase.google.com) → Your project → Project settings → Your apps
4. Find your Android app (`com.gyw1.chat`) → **Add fingerprint** → Paste SHA-1 → Save
5. Wait 2–3 minutes, then **Download** the new `google-services.json`
6. Replace `google-services.json` in your project root
7. Rebuild if you already built before adding SHA-1: `eas build --platform android --profile production`

---

## Step 3: Create Your App in Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. **Create app** (if you haven’t already)
3. Fill in app name (e.g. **GYW**) and default language

---

## Step 4: Complete Required Setup

In Play Console, complete these under **Policy** → **App content**:

| Task | Where | Notes |
|------|-------|-------|
| **App access** | Setup → App access | Declare if all features are free or if some require login |
| **Ads declaration** | Setup → Ads | Select **No** if you don’t use ads |
| **Content rating** | Policy → Content rating | Start questionnaire → Communication → Answer questions |
| **Target audience** | Policy → Target audience | Select age groups |
| **Data safety** | Policy → Data safety | Declare data collected (e.g. phone, messages, photos) |
| **Privacy policy** | Policy → App content | Use: `https://serverless-token-api.vercel.app/privacy-policy` |

---

## Step 5: Store Listing

Go to **Grow** → **Main store listing**:

| Field | Example |
|-------|---------|
| **App name** | GYW |
| **Short description** | (max 80 chars) Secure messaging, voice notes, and video calls |
| **Full description** | (max 4000 chars) Describe messaging, calls, stories, etc. |
| **App icon** | 512×512 PNG |
| **Feature graphic** | 1024×500 PNG |
| **Screenshots** | At least 2 phone screenshots (min 320px, max 3840px) |

---

## Step 6: First Upload (Manual – Required)

Google requires a **manual upload** the first time:

1. Play Console → **Release** → **Production** → **Create new release**
2. **Upload** your AAB (from Step 1)
3. Add **Release notes** (e.g. "Initial release")
4. **Save** → **Review release** → **Start rollout to Production**

---

## Step 7: Future Submissions (Optional – EAS Submit)

After the first manual upload, you can use EAS Submit:

1. Create a [Google Service Account](https://github.com/expo/fyi/blob/main/creating-google-service-account.md) with Play Console API access
2. Run: `eas credentials` → Android → Google Service Account Key → Upload your JSON key
3. Submit with: `eas submit --platform android --profile production --latest`

---

## Quick Reference

| Item | Value |
|------|-------|
| **Package** | `com.gyw1.chat` |
| **Version** | 1.0.0 (versionCode auto-increments) |
| **Privacy policy** | https://serverless-token-api.vercel.app/privacy-policy |
| **Build type** | AAB (Android App Bundle) |

---

## Troubleshooting

- **Build fails** – Check [EAS Build logs](https://expo.dev) for errors
- **Firebase auth fails in production** – Add production SHA-1 in Firebase and update `google-services.json`
- **Policy rejection** – Review [Play policies](https://support.google.com/googleplay/android-developer/answer/10787469)
