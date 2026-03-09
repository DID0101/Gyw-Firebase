# App Check and Cloud Functions

## 401 Unauthorized / UNAUTHENTICATED from Callables

If `tryRandomMatch` returns **401 Unauthorized** (HTML error page) or `errorCode: "unauthenticated"` even when:
- `auth.currentUser` exists
- `getIdToken(true)` succeeds
- Firestore writes work

**Cause:** App Check enforcement is enabled for Cloud Functions. Firebase rejects requests without a valid `X-Firebase-AppCheck` token **before** they reach your function.

## Quick Fix: Disable App Check Enforcement

1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. **App Check** (left sidebar)
3. Find **Cloud Functions** in the list
4. If "Enforce" is ON → click it and set to **Monitor** or **Off**
5. Save and wait a few minutes for changes to propagate

## Long-term: Add App Check on Client

If you want to keep App Check enforcement:

1. Install: `npm install @react-native-firebase/app-check`
2. Initialize App Check in your app (see Firebase docs)
3. The `httpsCallable` SDK will automatically attach the App Check token
4. For REST calls, add header: `X-Firebase-AppCheck: <app-check-token>`

**Note:** This codebase does not include App Check yet. Disable enforcement to unblock callables.
