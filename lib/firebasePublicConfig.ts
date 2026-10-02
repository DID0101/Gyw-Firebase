/**
 * Firebase config for gyw1-146d7.
 *
 * Two API keys:
 * - androidApiKey: from google-services.json — native Android SDK + Cloud Functions REST.
 * - browserApiKey: for WebView reCAPTCHA — Android-restricted keys return auth/invalid-api-key in WebView.
 *
 * Override browser key: EXPO_PUBLIC_FIREBASE_RECAPTCHA_API_KEY in .env.local
 */
const ANDROID_API_KEY = 'AIzaSyBctdX2zyTERwPQGPdfWzhNmZKBJtxiuns';

/** Firebase Console web/browser key (not Android-restricted). */
const BROWSER_API_KEY =
  process.env.EXPO_PUBLIC_FIREBASE_RECAPTCHA_API_KEY ??
  'AIzaSyCn7SzfpJ2BOTmmKmoxWR0fNBnHG6Xw0Pw';

const shared = {
  authDomain: 'gyw1-146d7.firebaseapp.com',
  projectId: 'gyw1-146d7',
  storageBucket: 'gyw1-146d7.firebasestorage.app',
  messagingSenderId: '1039699232254',
  appId: '1:1039699232254:web:65f4b901c63fc347786caf',
} as const;

/** RN web SDK + Firestore/Functions client (Android key matches google-services.json). */
export const firebasePublicConfig = {
  apiKey: ANDROID_API_KEY,
  ...shared,
} as const;

/** WebView reCAPTCHA only — must use browser key or RecaptchaVerifier init fails. */
export function getRecaptchaFirebaseConfig() {
  return {
    apiKey: BROWSER_API_KEY,
    ...shared,
  };
}

export const firebaseAndroidApiKey = ANDROID_API_KEY;
export const firebaseBrowserApiKey = BROWSER_API_KEY;
