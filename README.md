# GYW

React Native app (Expo Router) with **Firebase** (Auth, Firestore, Storage, Functions) and **WebRTC** for calls. Use a **development build** (`expo run:android` / `expo run:ios`), not Expo Go, for native Firebase modules.

## Setup

```bash
npm install
```

Create `.env.local` with your Firebase web config (see `app.config.js` / Expo `extra` keys), for example:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
```

## Run

```bash
npx expo run:android
# or
npx expo run:ios
```

## Cloud Functions

See `functions/` and deploy with the Firebase CLI (`firebase deploy --only functions`).
