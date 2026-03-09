# Publish GYW to Google Play Store

## Prerequisites

- **Google Play Developer account** – [Register](https://play.google.com/console/signup) ($25 one-time fee)
- **Expo account** – [Sign up](https://expo.dev/signup) (free)
- **EAS CLI** – `npm install -g eas-cli` then `eas login`

---

## Step 1: Build Production AAB

Your `eas.json` is already configured for Play Store (AAB format, auto-increment version).

```bash
# Build production Android app bundle
eas build --platform android --profile production
```

This creates an `.aab` file (Android App Bundle) required by Play Store. The build runs on Expo servers (~15–20 min).

---

## Step 2: Prepare Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app (if needed)
3. Complete **App setup**:
   - App access
   - Ads declaration (if you use ads – say no if you don’t)
   - Content rating
   - Target audience
   - News app (if applicable)
   - COVID-19 apps (if applicable)
   - Data safety

---

## Step 3: Store Listing

In Play Console → **Main store listing**:

| Field | Example |
|-------|---------|
| **App name** | GYW |
| **Short description** | (max 80 chars) Secure messaging and video calls |
| **Full description** | (max 4000 chars) Describe features: messaging, calls, stories, etc. |
| **App icon** | 512×512 PNG |
| **Feature graphic** | 1024×500 PNG |
| **Screenshots** | At least 2 phone screenshots (16:9 or 9:16) |

---

## Step 4: Content Rating

1. Play Console → **Policy** → **App content** → **Content rating**
2. Start questionnaire
3. Choose category (e.g. Communication)
4. Answer questions (messaging, user content, etc.)
5. Submit and receive rating (e.g. Everyone, Teen)

---

## Step 5: Data Safety

1. Play Console → **Policy** → **App content** → **Data safety**
2. Declare:
   - Data collected (e.g. email, phone, messages, photos)
   - How it’s used
   - Whether it’s shared with third parties
   - Security practices (data encrypted in transit, etc.)

---

## Step 6: App Signing

**Option A – EAS managed (recommended):**

EAS can create and manage the keystore. On first production build:

```bash
eas build --platform android --profile production
```

When asked about credentials, choose **Generate new keystore**. EAS will store it securely.

**Option B – Own keystore:**

1. Generate keystore: see `GENERATE_KEYSTORE.md`
2. Add production SHA-1 to Firebase Console
3. Download new `google-services.json` and replace the existing one
4. Run `eas credentials` and upload your keystore

---

## Step 7: Submit to Play Store

**Option A – Upload manually:**

1. Download the AAB from the [EAS Build dashboard](https://expo.dev/accounts/[your-account]/projects/gyw/builds)
2. Play Console → **Release** → **Production** → **Create new release**
3. Upload the AAB
4. Add release notes
5. Review and rollout

**Option B – EAS Submit:**

```bash
# Submit the latest production build
eas submit --platform android --profile production --latest
```

Or submit a specific build:

```bash
eas submit --platform android --profile production --id [BUILD_ID]
```

---

## Step 8: Required Info Checklist

- [ ] Privacy policy URL (you have: `https://serverless-token-api.vercel.app/privacy-policy`)
- [ ] App signing key configured
- [ ] Firebase `google-services.json` uses production SHA-1
- [ ] Store listing filled (name, description, icon, screenshots)
- [ ] Content rating completed
- [ ] Data safety form completed

---

## Quick Commands

```bash
# Full flow: build then submit
eas build --platform android --profile production
# After build completes:
eas submit --platform android --profile production --latest
```

---

## Your Current Config

- **Package:** `com.gyw1.chat`
- **Version:** 1.0.0 (versionCode auto-increments)
- **Build type:** AAB (Android App Bundle)
- **Privacy policy:** https://serverless-token-api.vercel.app/privacy-policy

---

## Troubleshooting

**Build fails:** Check [EAS Build logs](https://expo.dev) for errors.

**Firebase auth fails in production:** Add production keystore SHA-1 in Firebase Console and update `google-services.json`.

**Rejected for policy:** Review Play policies (e.g. [User Data](https://support.google.com/googleplay/android-developer/answer/10787469)).
