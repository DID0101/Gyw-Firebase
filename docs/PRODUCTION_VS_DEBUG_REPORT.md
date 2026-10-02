# Production vs Debug Investigation Report

**App:** GYW (`com.gyw1.chat`) · **Firebase:** `gyw1-146d7` · **Play build:** EAS production v39 (versionCode 39)  
**Symptom:** `npx expo run:android` works; Play Store install shows broken screens, partial translations, different feature behavior.

---

## Executive summary

| # | ROOT CAUSE | WHY DEBUG WORKS | WHY PLAY STORE FAILS | MINIMAL FIX |
|---|------------|-----------------|----------------------|-------------|
| 1 | **54 missing i18n keys** in `tr`/`ru`/`tk` vs `en` | Metro warns missing keys in dev (`NODE_ENV=development`) | `fallbackLng: 'en'` hides gaps; no dev warnings in release | Copy missing keys from `en.json` → `tr.json`, `ru.json`, `tk.json` (see §4) |
| 2 | **Hardcoded English UI** (not i18n) | Same strings visible in dev — often mistaken for “working” | Users expect Turkish/Russian/Turkmen | Replace literals with `t()` — e.g. `chats.tsx` L70–84, L838 (838 fixed) |
| 3 | **Production console silencing** | `__DEV__` → full `console.log/warn` | `app/_layout.tsx` L29–34 nulls log/warn/info/debug | Use new `productionDiagnostics` (`console.error`) or logcat filter |
| 4 | **R8/ProGuard enabled** on release only | Debug: minify off | `app.json` L129 `enableProguardInReleaseBuilds: true`; **no custom `-keep` rules** in repo | Add `extraProguardRules` for WebRTC/Reanimated/Firebase if crash logs show `ClassNotFoundException` |
| 5 | **Play App Signing SHA** may not match Firebase | Local debug keystore SHA often registered | Play re-signs with **app signing key**; if SHA missing → Phone Auth / some Google APIs fail | Add Play Console **App signing certificate SHA-1** to Firebase → `com.gyw1.chat` |
| 6 | **Discover / random match** needs deployed CF + client | Local may hit latest JS + emulators | Play v39 may lack `tryRandomMatch` deploy or old client queue logic | Deploy `functions:tryRandomMatch` (done in session); ship new build if client changed |
| 7 | **Dual Firebase SDK** (web + RNFB) | Both init; errors visible in Metro | Same init; release silences JS Firebase logs | Not a split project — same `gyw1-146d7`; fix auth/SHA not second project |
| 8 | **Lazy/dynamic imports** on chat/call | Failed chunk → red error in Metro | Failed `import()` → silent empty UI (emoji picker, group sheet) | Wrap loaders in `chat/[id].tsx` L1146–1154 with `logScreenFailed` + user retry |
| 9 | **`__DEV__` gated diagnostics** | SHA index, phone auth traces, discover audit | All no-ops in release | `productionDiagnostics` added for Play logcat |
| 10 | **Split APK / bundle** | Unlikely — single AAB, universal | Same | No action unless using ABI splits (not configured) |

---

## 1. Release build vs debug build

| Aspect | Debug (`expo run:android`) | Release (EAS `production`) | File:line |
|--------|---------------------------|----------------------------|-----------|
| Minify / R8 | Off | **On** | `app.json` **124–131** (`expo-build-properties`) |
| `__DEV__` | `true` | `false` | RN bundle |
| Console | Full | **Silenced** L29–34 | `app/_layout.tsx` **29–34** |
| Hermes | Default on (SDK 53) | Same | No override |
| EAS profile | N/A / dev client | `eas.json` **14–25** AAB + auto versionCode |
| Native tree | Local prebuild | EAS cloud prebuild | No committed `android/` |

---

## 2. R8 / ProGuard stripping

- **Enabled:** `app.json` → `expo-build-properties` → `android.enableProguardInReleaseBuilds: true` (**L129**).
- **Custom rules:** **None** in repo (grep `proguard` → empty).
- **Risk classes:** `react-native-webrtc`, `react-native-reanimated`, `@react-native-firebase/*`, Kotlin incoming-call plugins under `plugins/android-native/`.
- **Symptom if culprit:** Crash on specific screen (call, chat media), not “wrong language”.
- **MINIMAL FIX:** If logcat shows R8 strip, add to `app.json` under `expo-build-properties`:

```json
"android": {
  "enableProguardInReleaseBuilds": true,
  "extraProguardRules": "-keep class org.webrtc.** { *; }\n-keep class com.facebook.hermes.** { *; }"
}
```

(Adjust after matching stack trace — do not blanket-keep everything.)

---

## 3. Hermes release-only errors

- No `jsEngine: "jsc"` override — Hermes in **both** builds.
- Global handler in `lib/appInit.ts` **105–118** logs `[globalError]` via `console.error` (survives release silencing).
- **If Hermes-only:** reproduce on release APK, capture `adb logcat` for `hermes` / `globalError`.

---

## 4. Translation file bundling

### How i18n loads

| Step | File:function:line |
|------|-------------------|
| Side-effect import | `app/_layout.tsx` **15** |
| Static bundle all locales | `i18n/config.ts` **6–30** `require` JSON |
| Device language | `getDeviceLanguage()` **14–20** |
| Persisted override | `AsyncStorage` `@app_language` **44–48** |
| User switch | `changeLanguage()` **50–53** |
| Fallback | `fallbackLng: 'en'` **32** |

**Not lazy-loaded** — all JSON in release APK. Play Store does **not** omit locale files.

### Missing keys (54 per locale vs `en`)

Run: `node -e` diff script (or install build and filter `TRANSLATION_KEY_MISSING`).

**Critical namespaces missing in `tr`/`ru`/`tk`:**

| Namespace | Used in | Example keys |
|-----------|---------|--------------|
| `userProfile.*` (30 keys) | `app/(home)/user-profile.tsx` | `userProfile.title`, `userProfile.blockUser`, … |
| `stories.*` (15 keys) | `app/(home)/(modal)/story-viewer.tsx` | `stories.minutesAgo` **527**, `stories.activity` **739**, … |
| `auth.*` (11 keys) | `sign-up.tsx`, OTP flows | `auth.sendOTP`, `auth.invalidCode`, … |

**Chats 3-dot menu (`ChatsHeaderActions.tsx` L97–130):** keys **exist** in all locales — menu “not translating” is likely **stale menu state** or **English fallback elsewhere**, not missing `menuNewGroup`.

### Hardcoded English (behaves same in debug — looks “fine” if tester uses English)

| File | Lines | Issue |
|------|-------|-------|
| `app/(home)/(tabs)/chats.tsx` | **70–84** | `formatTime()` → `'now'`, `'5m'`, `'h'`, `'d'` |
| `app/(home)/(tabs)/chats.tsx` | **838** | Was `"No chats yet"` → fixed to `t('chats.noChats')` |
| `app/(auth)/sign-in.tsx` | **36–41** | Default label `'English'` |
| `components/AppMenu.tsx` | **~65** | Fallback `'User'` |

### Why language “does not change” on Play

1. **Fallback to English** for missing keys (user thinks switch failed).
2. **Hydration race:** device `lng` first, AsyncStorage later (`i18n/config.ts` **31 vs 44–48**) — one frame wrong language.
3. **Menu not re-rendered:** `ChatsHeaderActions` listens `languageChanged` (**L31–35**) — OK; other screens may cache `t()` in `useMemo` without `i18n.language` dep.

**MINIMAL FIX (i18n):** Sync 54 keys from `en.json` into `tr.json`, `ru.json`, `tk.json` (copy `userProfile`, `stories` activity block, `auth` OTP block). Use `scripts/update-locales.js` extended to full recursive merge.

---

## 5. Dynamic imports

| File | Line | Module | Release risk |
|------|------|--------|--------------|
| `app/(home)/chat/[id].tsx` | **1146–1148** | EmojiPicker, ImageViewer, GroupMembersSheet | Empty modal if chunk fails |
| `lib/hooks/useLazyComponent.ts` | **7–26** | Deferred load after interactions | Silent failure |
| `lib/services/callService.ts` | **172, 249, 303+** | `webrtcService` | Call connect delay/fail |
| `app/(home)/_layout.tsx` | **452–453** | incoming call guard | Missed incoming UI |
| `app/(auth)/sign-in.tsx` | **81** | `firebase/firestore` | Auth edge path |

Metro `inlineRequires: true` (`metro.config.js` **21–28**) — same in debug/release.

**MINIMAL FIX:** In `useLazyComponent.ts` catch block, call `logScreenFailed('LazyComponent', err, { name })`.

---

## 6. Firebase configuration

| Source | projectId | appId (Android `com.gyw1.chat`) |
|--------|-----------|-----------------------------------|
| `lib/firebase.ts` **12–18** | `gyw1-146d7` | Web: `...:web:65f4b901...` |
| `google-services.json` **52–57** | `gyw1-146d7` | `1:1039699232254:android:0e04f4d81f1c4a3b786caf` |
| EAS production | Same file | No alternate env in `eas.json` |

`app.config.js` **44–48** sets `EXPO_PUBLIC_FIREBASE_*` but **`lib/firebase.ts` does not read them** — unused for init.

**MINIMAL FIX:** None if project is correct; optional: read from `Constants.expoConfig.extra` for parity.

---

## 7. Firestore permissions

- `firestore.rules` — **no** debug/release branches; auth-based only.
- Play failures = `permission-denied` when **signed out**, wrong uid, or rule mismatch — same in debug if same user/rules.
- Discover fix uses `randomQueue/{uid}` listener — needs rules + `tryRandomMatch` CF deployed.

---

## 8. Play App Signing SHA fingerprints

`google-services.json` **com.gyw1.chat** SHA-1 entries (L65–98):

- `89246e33f0b444faa6d5feb19901889f216d1578`
- `5e8f16062ea3cd2c4a0d547876baa6f38cabf625`
- `6c5ed3631c7b94c0650294d3b02d36b4a247295b`
- `f2b3e80124f17d6af0808f56e341b85791992eb9`
- `0f6e4ad72480d134a7c4c503a5a0fa4546ae40ec`

`lib/auth/googleServicesShaIndex.ts` **39** — logs SHA list **only in `__DEV__`**.

**MINIMAL FIX:**

1. Play Console → Setup → App signing → copy **SHA-1** (app signing certificate).
2. Firebase Console → Project settings → Android `com.gyw1.chat` → add fingerprint.
3. Re-download `google-services.json` if needed.

---

## 9. Split APK / App Bundle

- EAS `buildType: "app-bundle"` (`eas.json` **17**).
- No ABI split config found — Play serves optimized splits automatically.
- **Unlikely** root cause for i18n; possible for **very large** native libs on old devices.

---

## 10. Missing assets in release

| Asset | Reference | Risk |
|-------|-----------|------|
| `assets/images/gyw_fox_logo.png` | `chats.tsx` **323** `require(...)` | try/catch → null if missing |
| Adaptive/icon/splash | `app.json` | Bundled by Expo |
| Locale JSON | `i18n/config.ts` | All bundled — not stripped |

---

## Production diagnostics added (logcat)

**Module:** `lib/debug/productionDiagnostics.ts`  
**Hook:** `lib/hooks/useProductionScreenTrace.ts`  
**Wired:** `lib/appInit.ts`, `i18n/config.ts`, screens: Chats, Stories, Discover, UserProfile, SignIn

| Tag | When |
|-----|------|
| `APP_ENVIRONMENT` | App start |
| `BUILD_TYPE` | App start |
| `LANGUAGE_CHANGE` | `changeLanguage`, AsyncStorage hydrate, i18n event |
| `TRANSLATION_KEY_MISSING` | i18n `missingKeyHandler` (all builds) |
| `TRANSLATION_KEY_FOUND` | Dev-only probe |
| `FIREBASE_PROJECT` / `FIREBASE_APP_ID` | After interactions |
| `SCREEN_MOUNTED` | Tab/screen mount |
| `SCREEN_FAILED` | Manual / lazy load errors |

**Play Store capture:**

```bash
adb logcat *:E | findstr /i "APP_ENVIRONMENT BUILD_TYPE LANGUAGE_CHANGE TRANSLATION_KEY SCREEN_ FIREBASE_"
```

---

## Screen-by-screen: debug vs Play

| Screen | File | Likely Play issue | Lines |
|--------|------|-------------------|-------|
| User profile | `user-profile.tsx` | English `userProfile.*` | `t('userProfile...')` throughout |
| Story viewer | `story-viewer.tsx` | English activity UI | **527, 631, 739+** |
| Chats list | `chats.tsx` | English times + was empty state | **70–84**, ~~838~~ |
| Chats menu | `ChatsHeaderActions.tsx` | Usually OK | **97–130** |
| Discover | `discover.tsx` + `randomMatchService.ts` | Match/call fail | CF + rules |
| Sign up OTP | `sign-up.tsx` | English auth errors | missing `auth.*` keys |
| Chat room | `chat/[id].tsx` | Lazy modals blank | **1146–1154** |
| Phone sign-in | `sign-in.tsx` | SHA / Play Integrity | `lib/phoneAuth.ts` **155+** |

---

## Prioritized MINIMAL FIX plan (no architecture change)

1. **i18n:** Merge 54 missing keys into `tr.json`, `ru.json`, `tk.json` from `en.json`.
2. **chats.tsx L70–84:** Use `t('chats.timeNow')` etc. (add keys to all locales).
3. **Firebase SHA:** Verify Play signing SHA in Firebase for `com.gyw1.chat`.
4. **Ship EAS build v40** after i18n + any call/discover JS fixes; test with logcat tags above.
5. **R8:** Only if crashes — add targeted `extraProguardRules`.
6. **Optional:** Temporarily set `enableProguardInReleaseBuilds: false` in one EAS build to **bisect** R8 vs i18n (revert after test).

---

## Files changed for this investigation

| File | Purpose |
|------|---------|
| `lib/debug/productionDiagnostics.ts` | Release log tags |
| `lib/hooks/useProductionScreenTrace.ts` | SCREEN_MOUNTED |
| `i18n/config.ts` | LANGUAGE_CHANGE, TRANSLATION_KEY_MISSING |
| `lib/appInit.ts` | APP_ENVIRONMENT, FIREBASE_* |
| `app/(home)/(tabs)/chats.tsx` | Screen trace + `noChats` i18n |
| `app/(home)/(tabs)/discover.tsx` | Screen trace |
| `app/(home)/(tabs)/stories.tsx` | Screen trace |
| `app/(home)/user-profile.tsx` | Screen trace |
| `app/(auth)/sign-in.tsx` | Screen trace |

---

*Generated: production-vs-debug investigation. Re-run locale diff after syncing JSON files.*
