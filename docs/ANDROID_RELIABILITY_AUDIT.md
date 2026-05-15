# Android reliability audit (GYW codebase)

This document is grounded in **this repository’s actual implementation** (Expo config plugins, native sources under `plugins/android-native/`, JS entry + notification layer). It is not generic Android guidance.

**Declared compatibility floor:** Android 7.0 **API 24** — `app.json` → `expo-build-properties.android.minSdkVersion` is **24** (aligned with Expo SDK 53 default; `android/gradle.properties` must match).

---

## 1. Compatibility risks found (exact)

| Risk | Evidence | Severity |
|------|----------|----------|
| **GMS-only push stack** | Firebase Cloud Messaging + `@react-native-firebase/messaging` throughout (`lib/registerBackgroundMessaging.ts`, `lib/services/NotificationService.ts`, native `GywFirebaseMessagingService.kt`). | **High** on Huawei / some China ROMs without Play Services — notifications and calls **cannot** match WhatsApp-class reliability without an alternate transport (e.g. HMS + vendor push). |
| **`targetSdk` / `compileSdk` 35** | `plugins/withAndroidIncomingCall.js` forces `compileSdk` / `targetSdk` **35**. | Correct for Android 14–15 APIs; increases policy surface (FGS types, background activity launches). Your native code already branches on API level in several places. |
| **WakeLock type** | `GywIncomingCallService` uses `PowerManager.SCREEN_BRIGHT_WAKE_LOCK` + `ACQUIRE_CAUSES_WAKEUP` (`GywIncomingCallService.java`). Deprecated patterns; OEMs may treat wakeups aggressively on battery saver. | Medium — mitigated by short `RING_WINDOW_MS` (30s) and cleanup in `onDestroy`. |
| **Headless JS limits** | `HeadlessCallTask.kt`: 30s timeout; started from FCM callback only. If OEM delays FCM, headless may never run on time. | Medium — same class of issue as all FCM apps; mitigated by **native-first** call UI (`GywIncomingCallNotifier`, `GywIncomingCallService`). |
| **Single messaging service** | Plugin removes RN Firebase’s default `ReactNativeFirebaseMessagingService` / receiver and installs **`GywFirebaseMessagingService`** only (`withAndroidIncomingCall.js`). | **Good** — avoids duplicate handlers; risk is **you must keep** merge rules correct after RNFB upgrades. |
| **POST_NOTIFICATIONS** | Declared in plugin + `app.json` permissions; runtime prompt must still be requested on API 33+ (Expo Notifications / your flows). | Medium if any path shows notifications without granted permission. |
| **`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`** | Declared in `withAndroidIncomingCall.js`; JS prompts via `IncomingCallBridge` + one-time `Alert` in `app/(home)/_layout.tsx`. | Policy risk if abused (Google Play); current code **prompts once**, not on every launch — aligned with best practice. |
| **Privacy / Play declarations** | `app.json` `android.privacyPolicy` URL may differ from Play Console (`privacy-policy.html` vs hosted URL). | Store policy mismatch risk, not runtime. |

---

## 2. Android-version-specific behavior (as implemented)

| OS | Topic | What this project does |
|----|--------|-------------------------|
| **8–9 (API 26–28)** | Background limits | FCM high-priority **data** path + native notification/FGS — aligned with pre‑BG restrictions; no reliance on “unlimited” background. |
| **10+ (API 29)** | Scoped storage / privacy | Uses Expo/React Native patterns; no audit issue found in repo for legacy raw paths in JS. |
| **12+ (API 31)** | `PendingIntent` mutability | Native notifiers use **`FLAG_IMMUTABLE`** for activity/broadcast PIs; **reply** uses **`FLAG_MUTABLE` only where needed** (`GywMessageNotifier.java`) — correct pattern. |
| **12+** | Notification trampoline | Full-screen intent + explicit `IncomingCallActivity`; `GywIncomingCallNotifier` consolidates notification **tag/id** to reduce duplicate surfaces. |
| **13+ (API 33)** | `POST_NOTIFICATIONS` | In manifest via plugin + app.json. |
| **14+ (API 34)** | Background activity launch | `GywIncomingCallNotifier.backgroundActivityLaunchBundle()` / `backgroundDirectStartBundle()` for **`MODE_BACKGROUND_ACTIVITY_START_ALLOWED`** — addresses **notification → Activity** and **FGS → Activity** restrictions. |
| **14+** | `foregroundServiceType=phoneCall` | `GywIncomingCallService` uses `startForeground(..., FOREGROUND_SERVICE_TYPE_PHONE_CALL)` on API 29+; manifest includes `FOREGROUND_SERVICE_PHONE_CALL` permission via plugin. |

---

## 3. Incoming call reliability (implemented path)

**Cold / killed / background:**  
`GywFirebaseMessagingService.kt` → `GywIncomingCallNotifier` + optional **`GywIncomingCallService`** (FGS, wake, ring) → `IncomingCallActivity` / deep link.  
Parallel: **`HeadlessCallTask`** → JS `GywCallHeadlessTask` registered in `index.js` for Firestore/cache updates (must stay lightweight).

**Strengths in code:**

- Native ring path **does not depend on JS** for the initial surface — critical for OEM killing.
- Android **14** background launch explicitly handled in `GywIncomingCallNotifier`.
- Duplicate RN Firebase messaging components **removed** to prevent double handling.

**Remaining real-world gaps:**

- OEM **battery** and **FCM delay** cannot be fully solved in app code — your `_layout` one-time settings prompt is the right UX pattern.

---

## 4. Notification reliability

- **Architecture:** Documented in `docs/MESSAGE_NOTIFICATIONS.md` — Android favors **data-only + high priority + local notification** for control over channels.
- **Deduping / identity:** Channel IDs centralized in `lib/notifications/constants.ts` and mirrored in Java (`GywIncomingCallNotifier.CHANNEL_ID`, `GywMessageNotifier`).
- **JS handler:** `NotificationService.ts` — foreground `onMessage`, background `setBackgroundMessageHandler`; chat messages may be **skipped in JS** when native `GywMessageNotifier` owns the banner (comment in code).

---

## 5. Performance on older / low-end devices

**Observed:**

- Chat screen `app/(home)/chat/[id].tsx` uses **`FlatList`** (not `FlashList`) — on very low RAM devices, **large threads** can cause JS pressure and slower scroll. Consider **`@shopify/flash-list`** for message lists if profiling shows frame drops.
- **Perf tracing hooks** exist (`lib/chatOpenPerf.ts` imports in chat screen) — good for measuring open latency on API 26–28 devices.

**Recommendations (only after measuring):**

- Reduce synchronous work on chat mount; defer non-critical `InteractionManager` tasks (pattern already imported).
- Keep **`newArchEnabled: false`** until you have CI perf benchmarks — stability first matches your goal.

---

## 6. Background execution safety

- **Headless:** `HeadlessCallTask` intentionally avoids `startForegroundService` (comment explains crash if `startForeground` not called).
- **FCM window:** IllegalStateException caught when starting headless outside allowed window — logged, not swallowed silently without trace.

---

## 7. OEM notes (honest)

| OEM | Reality |
|-----|--------|
| **Xiaomi / Oppo / Vivo** | Aggressive autostart + battery buckets — your **battery optimization + full-screen intent settings** prompt (`app/(home)/_layout.tsx` + `IncomingCallBridgeModule.kt`) is the correct mitigation; users may still need vendor-specific whitelist steps (document in-app copy if support burden is high). |
| **Samsung** | Generally better FCM; still test **Doze** + **sleeping apps**. |
| **Huawei without GMS** | **FCM will not work** — requires alternate SDK and backend; cannot be fixed by manifest tweaks alone. |

---

## 8. Crash / ANR prevention (code-facing)

- Global error logging wrapper in `lib/appInit.ts` — improves diagnosability without changing behavior.
- Native **try/catch** around `startForeground` and activity launch in call service — avoids hard crash when OEM denies FGS.

---

## 9. Manifest / Gradle / Proguard

- **Manifest:** Generated by Expo + `withAndroidIncomingCall.js` — services, permissions, and removal of duplicate RNFB components are **consistent** with a single FCM entrypoint.
- **Gradle:** Plugin injects Firebase BOM + messaging; Kotlin plugin guard — good for compile consistency.
- **R8:** `enableProguardInReleaseBuilds: true` in `app.json` — ensure release testing includes **incoming call + reply actions**; add consumer rules only if you see reflection-related crashes in production mapping.

---

## 10. Change log (repo)

- **`minSdkVersion`** was briefly raised to **26** (Android 8+ only); restored to **24** for Play device coverage while staying on Expo 53’s supported floor.

---

## 11. What “WhatsApp / Telegram / Signal class” would still require

1. **Vendor push alliances** or **HMS** where GMS is absent.  
2. **Sustained investment** in ANR-free startup (profiling on API 26 physical devices).  
3. **Server-side** message queue + retry aligned with FCM collapse keys / deduplication keys (partially addressed in your Cloud Functions design — not re-audited here).
