# Release APK Crash Investigation

**Symptom:** Preview/production APK installs but force-closes immediately. Dev client (`expo run:android` / development profile) works.

**Status:** Root cause **not yet confirmed** — logcat from a crashing device is required before applying a fix.

---

## Dev vs Release — What Actually Differs

| Factor | Dev client / `expo run:android` (debug) | Preview APK / `assembleRelease` |
|--------|------------------------------------------|----------------------------------|
| JS bundle | Metro live / dev bundle | Embedded Hermes bundle (`export:embed`) |
| `__DEV__` | `true` | `false` |
| R8 / ProGuard | **Off** (`minifyEnabled false`) | **On** (`android.enableProguardInReleaseBuilds=true`) |
| Sentry | `enabled: false` | `enabled: true` + `wrapRootComponent` |
| Console | Full | `console.log/warn/info/debug` silenced in `app/_layout.tsx` |
| Sentry source maps | N/A | Upload (preview: `SENTRY_DISABLE_AUTO_UPLOAD=true`) |
| Signing | Debug keystore | Release uses debug keystore locally; EAS uses credentials |

The crash pattern (works in debug, dies instantly in release) strongly correlates with **R8 minification** or **release-only JS paths** (`__DEV__`, Sentry), not with Firebase Auth/Firestore logic itself (those work in both when JS runs).

---

## APP_START_1 … APP_START_10 Markers

Added for ~2s delayed crash bisect. Filter logcat:

```powershell
adb logcat | findstr /i "APP_START"
```

| Marker | Phase | File |
|--------|-------|------|
| `APP_START_1` | App entry | `index.js` |
| `APP_START_2` | Firebase app (native `getApp`) | `lib/rnFirebase.ts` |
| `APP_START_3` | Analytics init | `lib/services/analyticsService.ts` |
| `APP_START_4` | Crashlytics init | `lib/services/crashlyticsService.ts` |
| `APP_START_5` | Performance trace start | `lib/services/performanceService.ts` |
| `APP_START_6` | Auth module (`getAuth`) | `lib/rnFirebase.ts` |
| `APP_START_7` | Firestore module (`getFirestore`) | `lib/rnFirebase.ts` |
| `APP_START_8` | Root navigation mount | `app/_layout.tsx` |
| `APP_START_9` | Chats tab mount | `app/(home)/(tabs)/chats.tsx` |
| `APP_START_10` | Chats Firestore listener attach | `lib/hooks/useChats.ts` |

Global handlers (from `index.js`):

- `APP_START_EXCEPTION` — `ErrorUtils.setGlobalHandler`
- `APP_START_UNHANDLED_REJECTION` — promise rejection handler

Implementation: `lib/debug/appStartupMarkers.ts` (markers use `console.error` mirror for release visibility).

**~2s crash interpretation:** If you see `APP_START_8` and `APP_START_9` but crash before `APP_START_10`, auth resolved and chats mounted but listener not attached yet. If `APP_START_10` then `APP_START_EXCEPTION`, the crash is in snapshot handling or a parallel effect (`useUserChatMeta`, `preloadAppData`, `initReliability`).

---

## Startup Sequence (instrumented)

### Native (before JS)

1. `NATIVE_STEP_0` — `MainApplication.onCreate` (`MainApplication.kt:48-71`)
2. `NATIVE_STEP_1` — `MainActivity.onCreate` (`MainActivity.kt`)

### JS (`index.js` → `lib/appInit.ts` → `app/_layout.tsx`)

| Step | Tag | Where |
|------|-----|-------|
| 1 | `STEP_1_APP_LAUNCHED` | `index.js` (top), global handlers |
| 2 | `STEP_2_FIREBASE_INIT` | `lib/rnFirebase.ts`, `firebaseMonitoringInit.ts` |
| 3 | `STEP_3_ANALYTICS_INIT` | `firebaseMonitoringInit.ts` (async) |
| 4 | `STEP_4_CRASHLYTICS_INIT` | `firebaseMonitoringInit.ts` |
| 5 | `STEP_5_PERFORMANCE_INIT` | `firebaseMonitoringInit.ts` |
| 6 | `STEP_6_AUTH_INIT` | `lib/rnFirebase.ts` |
| 7 | `STEP_7_FIRESTORE_INIT` | `lib/rnFirebase.ts` |
| 8 | `STEP_8_NAVIGATION_MOUNTED` | `app/_layout.tsx` |

Failures log as `[GYW_STARTUP][STEP_N_FAIL]` via `console.error` (survives prod console silencing).

---

## Ranked Suspected Causes

### 1. R8 / ProGuard stripping Firebase / RN / Sentry / MMKV classes — **~75%**

**Evidence:**

```59:59:android/gradle.properties
android.enableProguardInReleaseBuilds=true
```

```10:14:android/app/proguard-rules.pro
# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
# Add any project specific keep options here:
```

Release enables minification; project rules only keep Reanimated. No explicit keeps for:

- `io.invertase.firebase.**` (all `@react-native-firebase/*`)
- `com.google.firebase.**`
- `io.sentry.**`
- `com.margelo.nitro.**` / MMKV Nitro

Debug builds skip minification → identical JS/native bridges work.

**Logcat signature if this is the cause:**

```
E AndroidRuntime: FATAL EXCEPTION: main
E AndroidRuntime: java.lang.ClassNotFoundException: io.invertase.firebase...
E AndroidRuntime: java.lang.NoSuchMethodError: No virtual method ... Firebase...
E AndroidRuntime: Caused by: java.lang.RuntimeException: Unable to get provider io.invertase.firebase.crashlytics.ReactNativeFirebaseCrashlyticsInitProvider
```

Crashlytics registers a `ContentProvider` that runs **before** JS (`initOrder=98`). Provider failure = instant kill with **no** `STEP_1` logs.

**Bisect:** Build release with ProGuard disabled (see Build Validation). If APK boots, R8 is confirmed.

---

### 2. Native `ContentProvider` / Firebase Perf+Crashlytics Gradle plugins at cold start — **~55%**

**Evidence:**

```190:192:android/app/build.gradle
apply plugin: 'com.google.gms.google-services'
apply plugin: 'com.google.firebase.crashlytics'
apply plugin: 'com.google.firebase.firebase-perf'
```

```9:18:node_modules/@react-native-firebase/crashlytics/.../AndroidManifest.xml
<meta-data android:name="firebase_crashlytics_collection_enabled" android:value="false" />
<provider android:name="io.invertase.firebase.crashlytics.ReactNativeFirebaseCrashlyticsInitProvider" ... />
```

Perf plugin instruments bytecode at build time. Crashlytics provider initializes before React. Misconfiguration or stripped classes here crashes **before** any JS step.

**Logcat signature:**

```
E AndroidRuntime: ... ReactNativeFirebaseCrashlyticsInitProvider
E FirebaseCrashlytics: ...
E FirebasePerformance: ...
```

Last native log: `NATIVE_STEP_0 ... done` but **no** `NATIVE_STEP_1` → crash between Application and Activity (provider phase).

---

### 3. Sentry release init + `wrapRootComponent` — **~40%**

**Evidence:**

```35:44:lib/reliability/SentryManager.ts
sentry.init({
  dsn,
  enabled: !__DEV__,
  ...
});
```

```81:81:app/_layout.tsx
export default wrapRootComponent(RootLayout);
```

Sentry is **disabled in dev**, **enabled in release**. Team already documented Hermes + lazy chunk issues in `SentryManager.ts` and `metro.config.js` (`inlineRequires: false`).

**Logcat signature:**

```
E ReactNativeJS: [GYW_STARTUP][STEP_1_APP_LAUNCHED] ...
E ReactNativeJS: Requiring unknown module "####"
E ReactNativeJS: [GYW_STARTUP][STEP_8_NAVIGATION_MOUNTED_FAIL] ...
```

If you see `STEP_1` but crash before `STEP_2`, check `initSentry` in `index.js`.

---

### 4. Hermes release bundle / Metro deferred modules — **~30%**

**Evidence:** `metro.config.js` sets `inlineRequires: false` with comment about Hermes `"Requiring unknown module"` in release.

**Logcat signature:**

```
E ReactNativeJS: Requiring unknown module "2761"
E ReactNativeJS: Module AppRegistry is not a registered callable module
```

Usually appears **after** `STEP_1`, during `require('./lib/appInit')` or `expo-router/entry`.

---

### 5. Wrong Analytics API (`logAppOpen`) — **~2% (non-fatal)**

**Evidence:**

```51:52:lib/services/analyticsService.ts
await analyticsMod.setAnalyticsCollectionEnabled(instance, true);
await analyticsMod.logAppOpen(instance);
```

`logAppOpen` does **not** exist in `@react-native-firebase/analytics` modular exports (grep: no matches). Call is inside `try/catch` → logs failure, should not crash.

---

### 6. Package name / google-services mismatch — **~0%**

`com.gyw1.chat` matches across `app.json`, `build.gradle`, `google-services.json`. Auth/Firestore work in dev on same device → config is valid.

---

## Configuration Audit (Phase 4)

| Check | Status |
|-------|--------|
| Crashlytics Gradle plugin | ✅ `firebase-crashlytics-gradle:3.0.3` + app plugin |
| Perf Gradle plugin | ✅ `perf-plugin:2.0.2` + app plugin |
| Google services | ✅ Applied last in `app/build.gradle` |
| Firebase BOM | ✅ `34.10.0` in app `dependencies` |
| Duplicate Firebase init | ✅ No manual `FirebaseApp.initializeApp` in `MainApplication` |
| Hermes | ✅ `hermesEnabled=true` |
| Multidex | ⚠️ Not explicit in app `defaultConfig` (libraries set `multiDexEnabled`; usually OK on API 24+) |
| ProGuard rules | ❌ **Minimal — primary risk** |
| Analytics Expo plugin | ⚠️ Not in `app.json` plugins (autolink only; manifest merges OK) |
| `process.exit` in app code | ✅ None in runtime paths (scripts only) |

---

## Capture Evidence (Required Before Fix)

Connect device via USB, enable USB debugging, install crashing APK:

```powershell
adb logcat -c
adb install -r path\to\app-release.apk
adb shell am start -n com.gyw1.chat/.MainActivity
adb logcat -d *:E | findstr /i "GYW_STARTUP AndroidRuntime FATAL ReactNativeJS invertase firebase sentry"
```

Or live:

```powershell
adb logcat GYW_STARTUP:E ReactNativeJS:E AndroidRuntime:E *:S
```

### Interpretation matrix

| Last log seen | Crash layer | Next action |
|---------------|-------------|-------------|
| Nothing / only `AndroidRuntime` | Native pre-JS | R8 / ContentProvider / SoLoader |
| `NATIVE_STEP_0 done`, no `NATIVE_STEP_1` | Provider / early Activity | Crashlytics provider, ProGuard |
| `NATIVE_STEP_1 done`, no `STEP_1_APP_LAUNCHED` | Hermes / bundle load | Sentry, Metro bundle |
| `STEP_1` only | `index.js` / Sentry | Sentry init |
| `STEP_2` fail / `native_modules present:false` | RNFB bridge missing | ProGuard / autolinking |
| `STEP_4` then native FATAL | Crashlytics native | Crashlytics plugin + rules |
| `STEP_8` fail | React render | Component tree / Sentry wrap |

---

## Build Validation (Phase 6)

### Debug APK (baseline — should work)

```powershell
cd android
.\gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK

```powershell
cd android
.\gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

### EAS preview APK

```powershell
eas build --platform android --profile preview
```

### ProGuard bisect (confirms cause #1)

Temporarily in `android/gradle.properties`:

```
android.enableProguardInReleaseBuilds=false
```

Rebuild release. If crash disappears → add proper `-keep` rules (not disable ProGuard in production).

### Log commands

```powershell
adb logcat
adb logcat *:E
adb logcat ReactNative:V ReactNativeJS:V GYW_STARTUP:E *:S
```

---

## Phase 5 — Fix Policy

**Do not merge a fix until logcat identifies the failing layer.**

Likely fixes **after** confirmation:

| Confirmed cause | Minimal fix |
|-----------------|-------------|
| R8 / ProGuard | Expand `proguard-rules.pro` with RN Firebase, Firebase SDK, Sentry, Nitro/MMKV keeps |
| Crashlytics provider | ProGuard keeps + verify `ReactNativeFirebaseCrashlyticsInitProvider` in merged manifest |
| Sentry / Hermes | Defer Sentry init, remove `wrap` until after first frame, or disable replay integrations |
| Analytics API | Replace `logAppOpen` with `logEvent(analytics, 'app_open')` |

---

## Files Reference

- Startup trace: `lib/debug/releaseStartupTrace.ts`
- Entry: `index.js`
- Init chain: `lib/appInit.ts`, `lib/rnFirebase.ts`, `lib/services/firebaseMonitoringInit.ts`
- Release-only: `lib/reliability/SentryManager.ts`, `app/_layout.tsx`
- Android: `android/app/build.gradle`, `android/gradle.properties`, `android/app/proguard-rules.pro`
- Native: `android/app/src/main/java/com/gyw1/chat/MainApplication.kt`, `MainActivity.kt`
