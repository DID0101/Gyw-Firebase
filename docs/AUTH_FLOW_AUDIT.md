# Authentication Flow Audit

**Project:** GYW (`com.gyw1.chat`)  
**Date:** 2026-06-19  
**Scope:** Firebase Phone Auth only — login, signup, session, profile, navigation  
**Status:** Phase 1 complete — **no refactor code applied yet**

---

## Executive summary

Phone authentication works but is **not isolated**. Auth state is spread across **screens, three layout guards, AuthContext, AsyncStorage, in-memory session objects, and home-layout profile creation**. The app uses **two Firebase stacks on native** (RN Firebase + web JS SDK), which causes subtle `currentUser` bugs. OTP flow has **no single state machine**, **no operation locks**, and **optimistic navigation** that can skip profile completion. Unrelated feature work frequently touches shared init (`appInit`, `firebase.ts`, layouts), which explains recurring login regressions.

---

## 1. Current authentication flow diagram

### 1.1 App startup (before any screen)

```
App Launch (index.js)
    │
    ▼
app/_layout.tsx
    │  import '@/lib/appInit'  (FIRST — sync side effects)
    ▼
lib/appInit.ts
    │  Android: require('./rnFirebase')  → native Firebase singleton
    │  initFirebaseMonitoring(), markAppStart(), initReliability (deferred)
    ▼
AuthProvider mounts (contexts/AuthContext.tsx)
    │  import '@/lib/firebase'  → web SDK initializeApp + initializeAuth (ALL platforms)
    │  onAuthStateChanged (web OR native — one branch)
    │  onIdTokenChanged (second listener — token refresh only)
    ▼
Expo Router resolves initial route
    │
    ├── app/index.tsx          (welcome — Continue → /sign-up)
    ├── app/(auth)/*           (sign-in / sign-up)
    └── app/(home)/*           (main app — requires user)
```

### 1.2 Phone sign-in (existing user)

```
/sign-in
    │  useFocusEffect → loadPendingLoginIfFresh() from AsyncStorage
    │  restorePhoneLoginSession() → in-memory phoneLoginSession
    ▼
User taps Send OTP
    │  getNetworkQuality().isOnline check
    │  lib/phoneAuth.sendPhoneOTP()
    │      ├─ sendPhoneOtpNative()  (RN Firebase + prep + reCAPTCHA retry)
    │      └─ on missing-client-identifier → sendPhoneOtpServer() (Cloud Function)
    │  savePendingLogin:v1 → AsyncStorage
    │  setPhoneLoginSession() → in-memory
    ▼
User taps Verify
    │  lib/phoneAuth.confirmPhoneOTP()
    │      ├─ server mode → verifyPhoneLoginOtp CF → signInWithCustomToken
    │      └─ native/web → PhoneAuthProvider.credential → signInWithCredential
    ▼
Firebase Auth session established
    │  AuthContext onAuthStateChanged fires → user set, loading=false
    ▼
sign-in.tsx (SCREEN — not AuthManager)
    │  Direct Firestore getDoc users/{uid} — profile check
    │  On error: hasProfile = true (optimistic)
    │  clearPendingLogin()
    │  navigateOnce → chats OR sign-up?completeProfile=1
    ▼
(auth)/_layout.tsx (parallel)
    │  Firestore profile check + AsyncStorage profileCompleteCache:v1:{uid}
    │  Redirect rules (see §4)
    ▼
(home)/_layout.tsx
    │  setupUser() — may create/merge users/{uid} doc (duplicate path)
    │  registerPushTokens (already in AuthContext)
    ▼
/(home)/(tabs)/chats
```

### 1.3 Sign-up / complete profile

```
/sign-up
    │  completeProfile=1 → user already signed in, form only
    │  full signup → username check → OTP → writeUserDocReliable → updateProfile
    │  pendingSignup:v1 in AsyncStorage (10 min TTL)
    ▼
Same AuthContext + layout guards as sign-in
```

### 1.4 Sign-out

```
AuthContext.signOut()
    │  call session reset, firebaseSignOut / rnSignOut
    │  onAuthStateChanged → user=null, cache clear, FCM unregister
    ▼
(home)/_layout → redirect /sign-in
```

---

## 2. File inventory (auth-related)

| Layer | Files |
|-------|--------|
| **Bootstrap** | `index.js`, `app/_layout.tsx`, `lib/appInit.ts` |
| **Firebase init** | `lib/firebase.ts` (web SDK, all platforms), `lib/rnFirebase.ts` (native singleton) |
| **Session owner** | `contexts/AuthContext.tsx` |
| **OTP orchestration** | `lib/phoneAuth.ts`, `lib/auth/sendPhoneOtpNative.ts`, `lib/auth/sendPhoneOtpServer.ts`, `lib/auth/phoneLoginSession.ts` |
| **OTP persistence** | `lib/auth/pendingLoginState.ts`, `lib/auth/pendingSignupState.ts` |
| **OTP prep (Android)** | `lib/auth/ensureAuthUiReady.ts`, `lib/auth/phoneAuthNativePrepare.ts`, `lib/auth/androidPhoneAuthDev.ts`, `plugins/android-native/.../PhoneAuth*.kt` |
| **Profile writes** | `lib/auth/userProfileWrite.ts`, `lib/auth/signupQueue.ts` |
| **Screens** | `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx` |
| **Navigation guards** | `app/index.tsx`, `app/(auth)/_layout.tsx`, `app/(home)/_layout.tsx` |
| **Server fallback** | `functions/src/impl/phoneLoginHandler.ts` |
| **Diagnostics** | `lib/auth/androidAuthEnvironment.ts`, `lib/debug/runtimeDiagnostics.ts`, `lib/reliability/reliabilityLog.ts` |
| **Native edge case** | `plugins/android-native/.../NativeCallStateUpdater.java` (ephemeral auth listener) |

---

## 3. Every place that can change auth state

### 3.1 Firebase Auth user (signed in / out)

| Source | Mechanism |
|--------|-----------|
| `AuthContext` | `onAuthStateChanged` (web or RN) — **primary** |
| `lib/phoneAuth.confirmPhoneOTP` | `signInWithCredential` / `signInWithCustomToken` |
| `AuthContext.signOut` | `firebaseSignOut` / `rnSignOut` |
| Account deletion | `user.delete()` (if used from profile — rare) |

### 3.2 React auth UI state (loading / user)

| Source | State |
|--------|-------|
| `AuthContext` | `user`, `loading` (boolean only) |
| `sign-in.tsx` | `phone`, `verificationId`, `code`, `loading` |
| `sign-up.tsx` | form fields, step, `verificationId`, `loading` |
| `(auth)/_layout.tsx` | `profileComplete: boolean \| null` |
| `(home)/_layout.tsx` | `setupComplete` (not auth, but gates render) |

### 3.3 Persisted auth-adjacent state

| Key / store | Writer | Reader | TTL / notes |
|-------------|--------|--------|-------------|
| Firebase Auth persistence | RN native / web AsyncStorage | Auth restore on launch | Platform-managed |
| `pendingLogin:v1` | sign-in | sign-in focus | 10 min |
| `pendingSignup:v1` | sign-up | sign-up focus | 10 min |
| `phoneLoginSession` (memory) | phoneAuth | confirmPhoneOTP | **Lost on kill** unless restored from pendingLogin |
| `profileCompleteCache:v1:{uid}` | auth layout | auth layout | Until uid change |
| `pendingUsername` | sign-up | home setupUser | Until cleared |
| `pendingPhone` | **never written** | home setupUser | Dead code |
| `gyw:authLastKnownUid` | AuthContext | diagnostics | — |
| MMKV `pendingSignups` | userProfileWrite | signupQueue flush | Until write succeeds |

### 3.4 Navigation (effective auth routing)

| File | Condition → destination |
|------|-------------------------|
| `app/index.tsx` | `user` → `/(home)/(tabs)/chats` |
| `(auth)/_layout.tsx` | `user && profileComplete===false` → sign-up only |
| `(auth)/_layout.tsx` | `user && profileComplete!==false` → **Redirect chats** (includes `null` unknown) |
| `(home)/_layout.tsx` | `!user` → `/sign-in` |
| `sign-in.tsx` | after OTP → chats or sign-up (profile incomplete) |
| `sign-up.tsx` | after signup → chats |

**Problem:** Four independent routers can disagree during the window between OTP verify and profile check completion.

---

## 4. Duplicate auth listeners

| Listener | Location | Count | Notes |
|----------|----------|-------|-------|
| `onAuthStateChanged` | `AuthContext.tsx` | **1** (web XOR native) | Correct |
| `onIdTokenChanged` | `AuthContext.tsx` | **1** | Token refresh; separate from state |
| `AuthStateListener` | `NativeCallStateUpdater.java` | **Ephemeral** | Up to 3.5s wait on killed-state call actions; shares native FirebaseAuth instance |
| Screen-level auth | None | 0 | Screens use `useAuth()` only |

**Verdict:** No duplicate JS `onAuthStateChanged`. Risk is **competition between AuthContext and layouts/screens** interpreting the same `user`/`loading` differently, not duplicate Firebase subscriptions.

---

## 5. Multiple initialization problems

### 5.1 Dual Firebase stacks on native (critical)

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│ @react-native-firebase      │     │ firebase/* (web JS SDK)     │
│ getApp() in rnFirebase.ts   │     │ initializeApp in firebase.ts│
│ Auth listener (AuthContext) │     │ auth.currentUser often NULL │
│ Firestore/Functions native  │     │ db export, web auth fallback│
└─────────────────────────────┘     └─────────────────────────────┘
         Same projectId                    Same projectId
         Different JS objects              Different persistence path
```

**Impact:** Code using `auth.currentUser` from `@/lib/firebase` on native sees **null while user is signed in** via RN Firebase.

Known footgun:

```76:76:lib/services/chatService.ts
  return auth.currentUser?.uid ?? null;
```

(`getSignedInUid()` elsewhere uses RN auth — inconsistent.)

### 5.2 Initialization order

1. `appInit` (Android preloads `rnFirebase`)
2. First `@/lib/firebase` import → web SDK always initializes
3. `AuthProvider` mounts → subscribes to **native** auth on device
4. iOS: `rnFirebase` may lazy-init on first AuthContext import (not preloaded in appInit)

### 5.3 Web SDK auth on native

`lib/firebase.ts` runs `initializeAuth` with AsyncStorage on **every platform**. This creates a second auth persistence layer that is **not** the source of truth on native.

---

## 6. Race conditions

| ID | Scenario | What goes wrong |
|----|----------|-----------------|
| R1 | OTP verify → `setUser` → navigation | sign-in navigates before `(auth)/_layout` profile check finishes |
| R2 | Triple redirect | sign-in `navigateOnce`, auth layout `<Redirect>`, index.tsx redirect — debounced but overlapping |
| R3 | `loading=false` before token ready | `logResolvedTokenAvailability` async; callables may run before `getIdToken` succeeds |
| R4 | App kill during server OTP | `phoneLoginSession` RAM-only; sign-in restores from AsyncStorage; **sign-up does not restore server session** |
| R5 | Server OTP placeholder ID | Stored as `server:{prefix}`; verify uses in-memory `sessionInfo` — breaks if restore fails |
| R6 | Profile check error → chats | sign-in sets `hasProfile=true` on Firestore error; auth layout sends `profileComplete=null` to chats |
| R7 | Duplicate profile creation | sign-up `writeUserDocReliable` + home `setupUser` setDoc overlap |
| R8 | `setupComplete=true` immediately | Home renders before `setupUser()` finishes — chats without user doc |
| R9 | Auth layout blank flash | Returns `null` while `loading` — between OTP and first auth callback |
| R10 | Rate limit / integrity failures | Many retries → `TOO_MANY_ATTEMPTS_TRY_LATER` at Firebase project level |

---

## 7. Invalid combined states (today)

There is **no single auth state enum**. These combinations are possible and cause bugs:

| loading | user | verificationId | profileComplete | Meaning / bug |
|---------|------|----------------|-----------------|-----------------|
| false | null | set (OTP step) | — | User on OTP UI but logged out — OK |
| false | set | set | null | Verified but OTP UI state stale |
| false | set | — | null | Signed in, profile unknown → **sent to chats anyway** |
| true | null | set | — | OTP in progress, auth still initializing |
| false | set | — | false | Should be on sign-up; OK if layout wins |
| N/A | set | N/A | N/A | `sign-in.loading=true` + AuthContext `loading=false` simultaneously |

Screens use local `loading` **in addition to** AuthContext `loading` — no coordination.

---

## 8. Direct Firebase calls from screens (violations of single owner)

| Screen / layout | Direct call | Should be |
|-----------------|-------------|-----------|
| `sign-in.tsx` | Firestore `getDoc(users/{uid})` after verify | AuthManager profile check |
| `sign-up.tsx` | Firestore queries, `updateProfile`, `writeUserDocReliable` | AuthManager |
| `(auth)/_layout.tsx` | Firestore profile check | AuthManager / shared profile service |
| `(home)/_layout.tsx` | `setupUser` create/merge user doc | AuthManager idempotent create |
| `sign-in.tsx` | `sendPhoneOTP`, `confirmPhoneOTP` via lib | OK via lib, but should be AuthManager only entry |

---

## 9. Causes of random / recurring login failures

### 9.1 Configuration (environment — not app logic)

| Cause | Symptom | Evidence |
|-------|---------|----------|
| Play Integrity / reCAPTCHA not passing | `auth/missing-client-identifier` | Logs on multiple devices; CF logs same error |
| Firebase rate limit | `TOO_MANY_ATTEMPTS_TRY_LATER` | Cloud Function logs |
| Missing SHA-256 in Firebase Console | Integrity + reCAPTCHA fail | SHA-1 registered; SHA-256 may be missing |
| Real number without test bypass | All paths fail until GCP/Firebase fixed | Server fallback also requires verification token |

### 9.2 Architecture (code — fixable in refactor)

| Cause | Symptom |
|-------|---------|
| Dual auth SDK | Intermittent `UNAUTHENTICATED`, wrong uid in services |
| No OTP operation lock | Double tap → duplicate requests / rate limit |
| Optimistic navigation | User in chats without profile |
| In-memory session + kill | OTP verify fails after reopen |
| Four navigation owners | Wrong screen after login |
| Feature changes to `appInit` / layouts | Unrelated work breaks auth init order |
| Stale `pendingLogin` restore (fixed with TTL) | Jumped to OTP step — **partially fixed** |

### 9.3 Network / offline

| Cause | Symptom |
|-------|---------|
| Profile check fails mid-login | Treated as complete → chats |
| `writeUserDocReliable` fails | Queued to MMKV; user in app without Firestore doc |
| Offline OTP request | Blocked by `NetworkManager` — OK |
| Token refresh during poor network | `TOKEN_REFRESH_FAIL` logged; callables fail |

---

## 10. AuthContext vs proposed AuthManager overlap

**Today AuthContext owns:**

- `onAuthStateChanged` subscription
- `user` + `loading` React state
- Push token register/unregister
- Cache clear on account switch
- `signOut`
- Token availability logging

**Today screens own:**

- OTP send/verify flow
- Profile existence checks
- Navigation after login
- Pending OTP persistence

**Target (Phases 2–7):**

- **AuthManager** — all Firebase auth operations + state machine + locks
- **AuthContext** — thin React adapter: `useAuth()` reads AuthManager snapshot only
- **Layouts** — gate on `AUTH_READY` / `AUTHENTICATED` enum, never Firestore directly

---

## 11. Existing reliability building blocks (reuse in refactor)

| Module | Location | Reuse for auth |
|--------|----------|----------------|
| Retry with backoff | `lib/reliability/RetryManager.ts` | OTP send/verify, profile write |
| Network gate | `lib/reliability/NetworkManager.ts` | Pre-OTP, offline waiting state |
| Profile queue | `lib/auth/signupQueue.ts` + MMKV | Idempotent profile creation |
| Structured logs | `lib/reliability/reliabilityLog.ts`, `logAuthState` | Extend with `[AUTH_*]` tags |
| navigateOnce | `lib/safeAction.ts` | Keep; centralize in AuthManager navigation |

---

## 12. Recommended refactor order (Phases 2–10)

1. **AuthState.ts** — enum + transition table; forbid invalid combos  
2. **AuthManager.ts** — single owner; migrate `phoneAuth.ts` internals  
3. **AuthLogger.ts** — structured `[AUTH_*]` logs  
4. **Thin AuthContext** — subscribe to AuthManager only  
5. **Startup gate** — root layout waits for `AUTH_READY` before router  
6. **Screens** — sign-in/sign-up become dumb views; no Firestore  
7. **Profile service** — idempotent `ensureUserProfile(uid)` with lock  
8. **Remove dual-auth footguns** — `getSignedInUid()` everywhere  
9. **AUTH_TEST_PLAN.md** — manual QA matrix  
10. **No setTimeout navigation hacks** — explicit state-driven redirects  

---

## 13. Files that must NOT be broken by unrelated changes (guard list)

Treat as **auth critical path**:

- `contexts/AuthContext.tsx`
- `lib/firebase.ts`, `lib/rnFirebase.ts`, `lib/appInit.ts`
- `lib/phoneAuth.ts`, `lib/auth/*`
- `app/(auth)/*`, `app/(auth)/_layout.tsx`
- `app/(home)/_layout.tsx` (setupUser + unauth guard)
- `app/_layout.tsx`
- `patches/@react-native-firebase+auth+*.patch`
- `plugins/withAndroidFirebasePhoneAuthStable.js`
- `functions/src/impl/phoneLoginHandler.ts`

**Recommendation:** After refactor, add ESLint boundary rule or CI script: screens under `(auth)` must not import `firebase/firestore` or `@react-native-firebase/firestore` directly.

---

## 14. Phase 1 conclusion

The audit confirms user reports: authentication is **coupled to app startup, dual Firebase init, layout navigation, and screen-local state**. Failures are **predictable** (missing integrity verification, rate limits) but the architecture **amplifies** them into “random” broken login (wrong screen, duplicate profile, stale OTP, null currentUser).

**Next step:** Phase 2 — implement `AuthState.ts` and `AuthManager.ts` without removing old paths until migration is complete (strangler pattern).

No application code was modified during this audit.
