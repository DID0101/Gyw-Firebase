# Google Play device compatibility (GYW)

This note is based on **files in this repo**, not assumptions about Play Console UI.

## Root cause of a large device drop (e.g. ~1,200 fewer devices)

The app was built with **`minSdkVersion` 26** (Android 8.0). Any catalog device whose **declared API level is below 26** is **ineligible** for install/update.

Compared to a typical previous release at **API 24** (Expo SDK 53 default, Android 7.0+), raising the floor **24 → 26** removes **all Android 7.0 and 7.1 devices (API 24–25)**. Play’s “supported devices” count often drops by **hundreds to low thousands** for that delta alone, depending on region mix and how Google counts variants.

### Where 26 was set (must stay in sync)

| Location | Role |
|----------|------|
| `app.json` → `expo-build-properties` → `android.minSdkVersion` | **Source of truth** for `expo prebuild` / EAS; injects into Gradle. |
| `android/gradle.properties` → `android.minSdkVersion` | Used by the **bare** `android/` tree (`android/app/build.gradle` uses `rootProject.ext.minSdkVersion`). |

If these diverge, local `./gradlew` vs EAS can disagree. **Keep them equal.**

## What was *not* excluding devices (inspected)

| Check | Result in this repo |
|-------|------------------------|
| **`ndk { abiFilters ... }` only `arm64-v8a`** | **Not present** in `android/app/build.gradle`. Play ships split ABIs from AAB; no 32-bit ARM strip here. |
| **`reactNativeArchitectures`** | `android/gradle.properties` lists `armeabi-v7a,arm64-v8a,x86,x86_64` — local dev builds; **not** the same as Play “supported devices” (AAB splits per ABI). |
| **`uses-feature` hardware gates** | `plugins/withAndroidIncomingCall.js` adds **permissions** and services; **no** `<uses-feature android:required="true">` for camera/mic/etc. was added there. (Camera may still appear from Expo / image-picker / WebRTC config plugins — re-check merged manifest after `expo prebuild` if you tighten further.) |
| **Tablet / `supports-screens`** | `app.json` does not declare tablet exclusion; no manifest change found in repo that removes large screens. |
| **`targetSdk` / `compileSdk` 35** | Set in `plugins/withAndroidIncomingCall.js`; **does not** remove old devices by itself — **minSdk** does. |

## Recommended production floor (this project)

- **`minSdkVersion: 24`** — Matches **Expo SDK 53** default and React Native’s usual floor; restores **API 24–25** vs 26.
- **Do not go to 21** without verifying every native module (Firebase, WebRTC, CallKeep, your Kotlin services) against Google’s and vendors’ minimums; most Expo 53 stacks are validated at **24+**.

## After changing minSdk

1. Run **`npx expo prebuild --clean`** (or EAS) so the generated Android project picks up `expo-build-properties`.
2. Confirm merged **`AndroidManifest.xml`** / Gradle report **`minSdkVersion`** is **24**.
3. Smoke-test on **API 24–25** emulators or devices: cold start, chat, call, FCM.

## Files changed (this compatibility fix)

- `app.json` — `expo-build-properties.android.minSdkVersion` **26 → 24**
- `android/gradle.properties` — `android.minSdkVersion` **26 → 24**
- `docs/ANDROID_PLAY_DEVICE_COMPATIBILITY.md` — this document
- `docs/ANDROID_RELIABILITY_AUDIT.md` — compatibility line updated to match
