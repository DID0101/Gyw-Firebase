# Production Investigation Report

## Scope

Investigated Play Store / release-build differences for:

- Stories loading forever
- User search by username / phone number
- Recommended users from contacts
- AI / translation-related behavior
- Firebase initialization, Firestore, Storage, Functions
- Android release build, R8/Proguard, Hermes, package identity
- Environment variable availability

No random behavioral fixes were made. The code changes in this pass are production-safe instrumentation only.

## Executive Findings

### Root Causes Found

1. **Release builds silence `console.log`, `console.warn`, `console.info`, and `console.debug`.**
   - `app/_layout.tsx` lines 29-34 disables those methods when `__DEV__` is false.
   - Existing stories logs used `console.log` through `lib/debug/storiesLoadingTrace.ts`, so Play builds could lose the most important story-loading evidence.
   - Some contact-store logs used `console.log` and native/story errors were still `__DEV__` gated.
   - Fix applied: all new and existing feature diagnostics now go through `lib/debug/prodDebug.ts` and emit with `console.error` using `[PROD_DEBUG]`.

2. **Firebase client environment variables are configured in Expo config but not used for Firebase initialization.**
   - `app.config.js` lines 44-48 copies `EXPO_PUBLIC_FIREBASE_*` into `extra`.
   - `lib/firebase.ts` lines 12-18 uses hardcoded Firebase config for `gyw1-146d7`.
   - Production builds are therefore not dependent on `EXPO_PUBLIC_FIREBASE_*` for Firebase client init. Missing EAS env values would not explain Firestore/Search/Stories failures in the current code.

3. **Android release builds enable R8/Proguard while debug builds do not.**
   - `app.json` lines 124-130 sets `enableProguardInReleaseBuilds: true`.
   - `android/gradle.properties` line 61 sets `android.enableProguardInReleaseBuilds=true`.
   - `android/app/build.gradle` lines 111-118 enables `minifyEnabled` for release.
   - `android/app/proguard-rules.pro` only keeps Reanimated / TurboModule classes. There are no explicit keep rules for WebRTC, RN Firebase, custom call native code, or Expo modules.
   - This is a high-confidence release-only risk, but not yet proven as a root cause without logcat stack traces.

### High-Confidence Suspects

1. **Play Store build may be stale relative to local code.**
   - Current local `app.json` has Android `versionCode: 2`, while `eas.json` uses remote auto-increment for production.
   - “Recently added features missing” is consistent with installing an older uploaded AAB or a track/country/device receiving an older artifact.

2. **Stories can fail before evidence reaches Play logs unless release-safe logging is used.**
   - `useStories` subscribes to `stories where expiresAt > now`.
   - Native path uses `subscribeToStoriesNative` from `lib/firestoreNative.ts`.
   - Web fallback uses `onSnapshot` from `firebase/firestore`.
   - Firestore rules allow `stories` read if signed in, so failures are likely auth not attached, wrong Firebase native app, listener error, or R8/native module issue.

3. **Search and recommended contacts can legitimately return empty results without user-visible errors.**
   - Username search is exact-match only: `where('username', '==', candidate)`.
   - Phone search uses `where('phoneNumber', 'in', chunk)`, so stored phone format must exactly match one generated candidate.
   - Phone query chunk errors are logged and then skipped, which can become zero results.
   - Contacts recommendations depend on `READ_CONTACTS`, device contact data, normalized keys, and matching stored `users.phoneNumber`.

4. **AI feature depends on deployed Cloud Functions configuration, not Expo client env.**
   - `functions/src/impl/gywAi/handler.ts` resolves `GEMINI_API_KEY`, `CLOUD_RUNTIME_CONFIG.gyw.gemini_api_key`, or `functions.config().gyw.gemini_api_key`.
   - `functions/src/impl/gywAi/multimodalHandler.ts` also uses `FIREBASE_STORAGE_BUCKET`, `GCLOUD_PROJECT`, or `GCP_PROJECT` for generated-image storage.
   - Missing Gemini / Storage function env would break production even if `expo run:android` client behavior appears fine.

5. **Non-Android Firebase config gaps exist and should not be confused with the Android Play issue.**
   - No `GoogleService-Info.plist` was found and `app.json` has no `ios.googleServicesFile`.
   - `app.json` uses iOS bundle id `com.tropicolx.signal-clone`, while the Android `google-services.json` only contains iOS OAuth references for `com.gyw.chat`.
   - Cloud Functions have conflicting fallback `IOS_BUNDLE_ID` values across call push handlers. This affects iOS/APNs risk, not the current Android Stories/Search/Contacts failure.

## Environment Analysis

| Variable | Used In | Loaded By | Production Availability | Finding |
|---|---|---|---|---|
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | `app.config.js` lines 10-14 | Expo config at build time | Only if present in local/EAS env during prebuild/build | Affects native Google Maps API key only, not Stories/Search/AI. |
| `GOOGLE_MAPS_API_KEY` | `app.config.js` lines 10-14 | Expo config at build time | Only if present in local/EAS env | Fallback for maps only. |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | `app.config.js` line 44, README/setup docs | Expo `extra` | Only if present in EAS env | Not used by `lib/firebase.ts`; missing value does not change current Firebase init. |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | `app.config.js` line 45 | Expo `extra` | Only if present in EAS env | Not used by `lib/firebase.ts`. |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | `app.config.js` line 46 | Expo `extra` | Only if present in EAS env | Not used by `lib/firebase.ts`. |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | `app.config.js` line 47 | Expo `extra` | Only if present in EAS env | Not used by `lib/firebase.ts`. |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | `app.config.js` line 48 | Expo `extra` | Only if present in EAS env | Not used by `lib/firebase.ts`. |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `README.md` only | Documented only | N/A | Not wired in `app.config.js` and not consumed by app code. |
| `EAS_SKIP_AUTO_FINGERPRINT` | `eas.json` line 21 | EAS production build env | Present for EAS production profile | Build optimization/control only. |
| `NODE_OPTIONS` | `eas.json` line 22 | EAS production build env | Present for EAS production profile | Build memory only. |
| `GEMINI_API_KEY` | `functions/src/impl/gywAi/handler.ts`, `multimodalHandler.ts` | Cloud Functions runtime env | Must be configured in Firebase/Google Cloud function env | Required for AI replies and multimodal AI. |
| `CLOUD_RUNTIME_CONFIG` | `functions/src/impl/gywAi/handler.ts` | Cloud Functions runtime | Present only if functions config exists | Legacy fallback for Gemini key. |
| `FIREBASE_STORAGE_BUCKET` | `functions/src/impl/gywAi/multimodalHandler.ts` | Cloud Functions runtime env | Optional, but important if default bucket inference is wrong | Used for saving AI-generated images. |
| `GCLOUD_PROJECT` / `GCP_PROJECT` | `functions/src/impl/gywAi/multimodalHandler.ts` | Cloud Functions runtime | Usually present in Cloud Functions | Used to infer Storage bucket names. |
| `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` | `functions/src/impl/initiateCallHandler.ts`, `callPushHandler.ts` | Cloud Functions runtime env | Required for iOS APNs only | Not relevant to Android Play feature failures. |
| `IOS_BUNDLE_ID` | `functions/src/impl/initiateCallHandler.ts`, `callPushHandler.ts` | Cloud Functions runtime env | Optional fallback exists | iOS only. |
| `NODE_ENV` | call push handlers | Cloud Functions runtime env | Depends on deployment env | Selects APNs production vs sandbox, Android unaffected. |
| `process.env.EXPO_OS` | `components/HapticTab.tsx` | Expo bundler-defined | Expo-managed | iOS haptics only. |

No checked-in `.env` or `.env.*` files were found in the workspace root. `dotenv` exists in package lock dependencies through Expo tooling, but no app code imports `dotenv`.

## Firebase Investigation

### Project and App Identity

| Source | Value |
|---|---|
| `lib/firebase.ts` | `projectId: gyw1-146d7`, `storageBucket: gyw1-146d7.firebasestorage.app`, web app id `1:1039699232254:web:65f4b901c63fc347786caf` |
| `google-services.json` | `project_id: gyw1-146d7`, `storage_bucket: gyw1-146d7.firebasestorage.app` |
| `app.json` Android package | `com.gyw1.chat` |
| `android/app/build.gradle` applicationId | `com.gyw1.chat` |
| `google-services.json` Android client | Contains `com.gyw1.chat` with app id `1:1039699232254:android:0e04f4d81f1c4a3b786caf` |

Finding: the checked-in Firebase project and Android package are aligned. `google-services.json` also contains an older `com.gyw.chat` client, but the current `com.gyw1.chat` client exists and matches the app package.

### iOS Firebase Note

This report is focused on Android Play Store behavior, but the config audit found iOS-specific gaps:

- No `GoogleService-Info.plist` is present in the repo.
- `app.json` does not configure `ios.googleServicesFile`.
- `app.json` iOS bundle id is `com.tropicolx.signal-clone`, while `google-services.json` OAuth iOS references point at `com.gyw.chat`.
- `functions/src/impl/initiateCallHandler.ts` defaults `IOS_BUNDLE_ID` to `com.gyw1.chat`; `functions/src/impl/callPushHandler.ts` defaults it to `com.tropicolx.signal-clone`.

These are not likely causes for Android Play Stories/Search/Contacts failures, but they are high-risk for iOS native Firebase/APNs behavior.

### Firestore Rules and Indexes

- `firestore.rules` lines 41-45 allow signed-in users to read all `users`, which is required by search and recommendations.
- `firestore.rules` line 330 allows signed-in users to read `stories`.
- `firestore.rules` lines 332-340 allow story creation by the story owner.
- `firestore.indexes.json` does not define `users.username`, `users.phoneNumber`, or `stories.expiresAt` composite indexes. These current queries are single-field `==`, `in`, or range queries, so automatic single-field indexes should be sufficient.
- Missing composite indexes are not the leading suspect for the inspected search/stories queries.

### Storage Rules

- `storage.rules` lines 5-10 allow authenticated users to write under `stories/{userId}/...`.
- `storage.rules` lines 14-20 allow authenticated chat media reads/writes.
- `storage.rules` lines 23-29 allow authenticated avatar writes by owner.

Finding: rules are consistent with story upload and AI-generated chat image access if Firebase Auth is attached correctly.

## Android Release Build Investigation

| Area | Finding |
|---|---|
| R8 / Proguard | Enabled in release. High-confidence suspect for release-only native module failures, not proven yet. |
| Hermes | Enabled by `android/gradle.properties` line 42. No evidence of debug/release JS engine mismatch; Hermes is expected in both unless local debug overrides it. |
| Signing | `android/app/build.gradle` release currently references debug signing config locally, but EAS production signing is controlled by EAS credentials for AAB builds. Verify Play App Signing SHA is registered in Firebase. |
| Package | `com.gyw1.chat` consistently appears in `app.json`, Gradle namespace/applicationId, and `google-services.json`. |
| Android permissions | `android/app/src/main/AndroidManifest.xml` includes `INTERNET` and `READ_CONTACTS`, plus generated call/media permissions. Contacts permission is declared. |
| Expo Updates | Native manifest has `expo.modules.updates.ENABLED=false`, so Play behavior depends on the installed binary, not OTA updates. |
| Local release signing | Local `android/app/build.gradle` release uses debug signing config; EAS/Play signing is different, so local release is not a signing-equivalent Play reproduction. |

Recommended R8 test: create one internal-track build with `enableProguardInReleaseBuilds: false` only to bisect whether R8 is involved. Re-enable once logs identify the stripped library/class.

## Feature Investigations

### Stories

Inspected:

- `app/(home)/(tabs)/stories.tsx`
- `lib/hooks/useStories.ts`
- `lib/services/storyService.ts`
- `lib/firestoreNative.ts`
- `firestore.rules`
- `storage.rules`

Query:

- Native: `subscribeToStoriesNative()` queries `stories where expiresAt > now`.
- Web fallback: `onSnapshot(query(collection(db, 'stories'), where('expiresAt', '>', Timestamp.now())))`.

Findings:

- Firestore rules allow signed-in reads.
- `useStories` has a 10-second timeout, so the current local code should not spin forever indefinitely unless the installed Play build is older, JS execution is stuck before the timeout, or the screen never receives current code.
- Prior story logs used `console.log`; release silenced them.
- New logs added show listener start, snapshot count, listener errors, Storage upload, story document writes, and read/write failures.

### Search

Inspected:

- `app/(home)/(modal)/find-by-username.tsx`
- `lib/services/userSearchService.ts`
- `lib/phoneNormalize.ts`
- `lib/contacts/phoneNormalization.ts`
- `firestore.rules`
- `firestore.indexes.json`

Queries:

- Username: exact `where('username', '==', candidate)`.
- Phone: `where('phoneNumber', 'in', chunk)` with normalized candidates.

Findings:

- Search is exact-match, not fuzzy/prefix search.
- No composite index is required for the current single-field queries.
- `users` reads require auth. If RN Firebase auth is not ready/attached in release, results can fail with `permission-denied`.
- Phone search can miss if stored `users.phoneNumber` is not one of the generated phone candidates.
- Existing search logs now use `[PROD_DEBUG]` via `console.error`.

### Recommended Contacts

Inspected:

- `lib/hooks/useContactRecommendedUsers.ts`
- `store/contactsStore.ts`
- `android/app/src/main/AndroidManifest.xml`
- `app.json`

Findings:

- `READ_CONTACTS` is declared in both Expo config and generated Android manifest.
- Runtime permission is requested with `expo-contacts`.
- Recommendations depend on local contact permission, readable phone numbers, normalized lookup keys, and exact Firestore phone matches.
- Contacts cache logs previously used `console.log`; release silenced them.
- New logs show permission status, contact row count, normalized key count, cache hydration count, and read failures.

### AI / Translation

Inspected:

- `lib/services/gywAiService.ts`
- `app/(home)/chat/[id].tsx`
- `functions/src/impl/gywAi/handler.ts`
- `functions/src/impl/gywAi/multimodalHandler.ts`
- `functions/src/impl/gywAi/gemini.ts`
- `functions/src/impl/gywAi/geminiMultimodal.ts`
- `i18n/config.ts`

Findings:

- AI callables are `gywAiReplyV1` and `gywAiMultimodalV1`.
- Native client prefers RN Firebase Functions from `lib/rnFirebase.ts`, region `us-central1`.
- Server requires Gemini key via Cloud Functions runtime config/env.
- Client Expo env variables do not provide Gemini keys.
- Function-side missing key returns `failed-precondition`.
- Provider errors are classified and returned as callable errors.
- i18n translations are statically bundled from JSON files; missing UI translation keys are logged through `productionDiagnostics`.
- New logs show sanitized AI request payload, response shape, callable errors, function request shape, key availability source, provider errors, and response lengths.

## Logs Added

All added logs use `console.error` and are prefixed with `[PROD_DEBUG]`.

| File | Logs Added |
|---|---|
| `lib/debug/prodDebug.ts` | New reusable production logger and error serializer. |
| `lib/debug/storiesLoadingTrace.ts` | Existing story tags now emit as `[PROD_DEBUG][STORIES_LOAD]`. |
| `lib/debug/searchLoadingTrace.ts` | Existing search/contact tags now emit as `[PROD_DEBUG][...]`. |
| `lib/debug/productionDiagnostics.ts` | App, Firebase, screen, language, translation diagnostics now use shared logger. |
| `lib/firebase.ts` | Web Firebase init/reuse, Firestore init/reuse, Functions provider. |
| `lib/rnFirebase.ts` | Native Firebase app id, project id, package name, service availability, init failure. |
| `contexts/AuthContext.tsx` | Auth state changes, provider path, uid prefix, sign-out start/errors. |
| `lib/firestoreNative.ts` | Native stories listener unavailable/start/snapshot/error. |
| `lib/services/storyService.ts` | Story create, Storage upload start/success/error, Firestore story/view/like reads/writes/errors. |
| `store/contactsStore.ts` | Contact permission, device rows, normalized keys, cache hydration, preload errors. |
| `lib/services/gywAiService.ts` | AI callable request/response/error payloads. |
| `functions/src/impl/gywAi/handler.ts` | Function request, Gemini key source, provider error, response length. |
| `functions/src/impl/gywAi/multimodalHandler.ts` | Function request, key availability, route decision, provider errors, response length. |

Suggested Android logcat filter:

```bash
adb logcat *:E | findstr /i "PROD_DEBUG globalError Firebase Firestore GYW_AI STORIES SEARCH CONTACT"
```

## Priority Ranking

1. **Install the newly instrumented internal build and capture `[PROD_DEBUG]` logs on the failing Play-installed device.**
2. **Verify the Play App Signing SHA-1/SHA-256 are registered in Firebase for `com.gyw1.chat`.**
3. **Verify Play Console track/versionCode delivers the same build that contains the recently added features.**
4. **Check Cloud Functions env/config for `GEMINI_API_KEY` or `gyw.gemini_api_key`, and `FIREBASE_STORAGE_BUCKET` if image generation fails.**
5. **If logs show native module/class errors, run an R8-bisect build with Proguard temporarily disabled, then add targeted keep rules.**
6. **If search logs show empty phone candidates or zero matches, normalize stored user phone numbers and/or add a dedicated `phoneLookupKeys` field.**
7. **If contacts logs show permission denied/no keys, treat recommendations as a permissions/data issue rather than Firestore.**

## Recommended Fixes After Evidence

- Do not change Firebase project config unless logs show a different runtime project/app id.
- Do not add broad Proguard keep rules until a release stack trace points to stripped classes.
- For search robustness, consider storing `usernameLower`, `usernameSearchTokens`, and `phoneLookupKeys` on each user doc, then query those fields explicitly.
- For stories, if logs show listener permission errors despite signed-in auth, force story subscriptions to wait until `AuthContext.loading === false` and current user is non-null.
- For AI, deploy functions after setting `GEMINI_API_KEY`, then confirm `[PROD_DEBUG][GYW_AI_KEY_SOURCE]` reports `geminiHasKey: true`.

