# Auth Refactor Progress (Phase 2)

Strangler migration: old auth paths keep working until AuthManager fully replaces them.

**Target stack**

```
Firebase Auth
      ↓
AuthManager (single owner)
      ↓
AuthContext (React subscription)
      ↓
Navigation Controller (Phase 8+)
      ↓
Screens
```

---

## Phase 2 — Completed

| Item | Status | Notes |
|------|--------|-------|
| `lib/auth/AuthState.ts` | ✅ | Strict FSM, 14 phases, single active state |
| `lib/auth/authLogger.ts` | ✅ | `[AUTH_STATE_TRANSITION]` with from/to/reason/timestamp |
| `lib/auth/authLocks.ts` | ✅ | Locks for init, OTP send, OTP verify, profile create |
| `lib/auth/AuthManager.ts` | ✅ | Sole owner of listeners + OTP + signOut + profile interface |
| `lib/auth/authCompat.ts` | ✅ | Adapter for sign-in/sign-up |
| `lib/auth/authIdentity.ts` | ✅ | `getAuthUser()` / `getSignedInUid()` via AuthManager |
| `lib/auth/authUserMapper.ts` | ✅ | Native → web User shape |
| `contexts/AuthContext.tsx` | ✅ | Thin layer; subscribes to AuthManager |
| `app/(auth)/sign-in.tsx` | ✅ | OTP via `authCompat` |
| `app/(auth)/sign-up.tsx` | ✅ | OTP via `authCompat` |

---

## Remaining old code (do not delete yet)

| File | What still bypasses AuthManager | Phase |
|------|----------------------------------|-------|
| `lib/phoneAuth.ts` | Internal OTP implementation (AuthManager delegates here) | 6 |
| `lib/auth/sendPhoneOtpNative.ts` | Native Firebase phone APIs | 6 |
| `lib/auth/sendPhoneOtpServer.ts` | Cloud Function OTP fallback | 6 |
| `app/(auth)/sign-in.tsx` | Profile check + Firestore read after verify | 5–6 |
| `app/(auth)/sign-up.tsx` | Profile write, `getRnAuth()?.currentUser`, `updateProfile` | 6 |
| `app/(auth)/_layout.tsx` | Profile gate / redirect logic | 8 |
| `app/(home)/_layout.tsx` | `setupUser()` profile bootstrap | 6 |
| `contexts/AuthContext.tsx` | Legacy comment block only | — |

Mark removals with `TODO: AUTH_REFACTOR_REMOVE`.

---

## Dangerous areas

1. **Dual Firebase Auth on native** — Web SDK `auth` in `lib/firebase.ts` is initialized but session lives on `@react-native-firebase/auth`. Code reading `auth.currentUser` on native often sees `null` while the user is signed in.
2. **Multiple profile writers** — sign-in, sign-up, `(auth)/_layout`, `(home)/_layout` can race on first login.
3. **OTP session memory** — `phoneLoginSession.ts` in-memory state must match AsyncStorage pending login (server mode uses `sessionInfo`).
4. **Listener duplication** — Only AuthManager may attach `onAuthStateChanged` / `onIdTokenChanged`. Do not re-add listeners in AuthContext.
5. **Illegal FSM transitions** — Blocked in dev with console warning; use `forceTransition` only for recovery.

---

## Files still accessing auth directly

### Must migrate to `authIdentity` / AuthManager (Phase 3–4)

| File | Pattern | Risk |
|------|---------|------|
| `lib/services/chatService.ts` | `auth.currentUser`, `getRnAuth()?.currentUser` | High — wrong uid on native |
| `lib/services/randomMatchService.ts` | `getAuth(rnApp).currentUser` | High — callables |
| `app/(home)/call/[id]/index.tsx` | `getAuth(rnApp).currentUser` | High — Stream token |
| `app/(auth)/sign-up.tsx` | `getRnAuth()?.currentUser`, `updateProfile` | Medium |
| `app/(home)/(modal)/profile.tsx` | `getRnAuth()`, `deleteUser`, `updateProfile` | Medium |

### Infrastructure (keep for now)

| File | Role |
|------|------|
| `lib/firebase.ts` | Web SDK init — Firestore, Functions, Storage still depend on it |
| `lib/rnFirebase.ts` | Native app + `getRnAuth()` — AuthManager uses this |
| `lib/phoneAuth.ts` | OTP impl — internal to AuthManager until Phase 6 |
| `lib/auth/sendPhoneOtpNative.ts` | Native OTP |
| `lib/auth/androidPhoneAuthDev.ts` | Dev test flags |

### Already on new path

| File | Role |
|------|------|
| `lib/auth/AuthManager.ts` | Single listener owner |
| `contexts/AuthContext.tsx` | Subscribes to AuthManager |
| `lib/auth/authCompat.ts` | Screen adapter |
| `lib/auth/authIdentity.ts` | Read-only uid helpers |

---

## Firebase ownership migration plan

### Current state (native Android/iOS)

| Concern | Owner today | Target |
|---------|-------------|--------|
| Auth session | `@react-native-firebase/auth` via AuthManager | Same |
| Auth listeners | AuthManager only | Same |
| ID tokens for callables | Mixed: RN `getIdToken` in some files, web `auth` in others | AuthManager `getIdToken()` helper (Phase 3) |
| Firestore | RN Firestore on native, web on web | Unchanged |
| Functions | Web `httpsCallable` + RN token | Unchanged |
| Web SDK `auth` init | Still runs in `lib/firebase.ts` | Keep until Firestore/Functions decoupled; stop reading `auth.currentUser` on native |

### Phase 3 actions (next)

1. Add `authManager.getIdToken(forceRefresh?)` wrapping platform token fetch.
2. Replace `auth.currentUser` in `chatService.ts`, `randomMatchService.ts`, `call/[id]/index.tsx` with `getSignedInUid()` / `getIdToken()`.
3. Document web-only paths (`signInWithPhoneNumber` + RecaptchaVerifier) as web-only in AuthManager.

### Do not remove yet

- `lib/firebase.ts` web auth init — other services import `db`, `functions`, `storage` from same module.
- `@react-native-firebase/auth` — authoritative session on native.

---

## FSM reference

```
APP_STARTING → FIREBASE_READY → CHECKING_SESSION
  → UNAUTHENTICATED | AUTHENTICATED → AUTH_READY

OTP: AUTH_READY → REQUESTING_OTP → OTP_SENT → VERIFYING_OTP → AUTHENTICATED → AUTH_READY

Profile (Phase 6+): AUTHENTICATED → CHECKING_PROFILE → CREATING_PROFILE → PROFILE_READY → AUTH_READY

Errors: * → AUTH_ERROR → recovery states
Offline: * → OFFLINE → resume prior flow
```

Logs: filter Metro / prod debug for `AUTH_STATE_TRANSITION`.

---

## Phase checklist

- [x] Phase 1 — Audit (`docs/AUTH_FLOW_AUDIT.md`)
- [x] Phase 2 — FSM + AuthManager + compat layer (this doc)
- [ ] Phase 3 — `authIdentity` migration for services
- [ ] Phase 4 — Inline OTP into AuthManager (remove `phoneAuth` delegation)
- [ ] Phase 5 — Profile FSM (`CHECKING_PROFILE`, `CREATING_PROFILE`)
- [ ] Phase 6 — Single profile creation owner
- [ ] Phase 7 — Remove web auth init on native (if safe)
- [ ] Phase 8 — Navigation controller driven by `authPhase`
- [ ] Phase 9 — Delete `authCompat` + legacy paths
- [ ] Phase 10 — Hardening + tests

---

## Verification (Phase 2)

- App boots: AuthContext `loading` true until first `handleAuthStateChanged`.
- Sign-in / sign-up: OTP flows unchanged; FSM transitions logged.
- Sign-out: `authManager.signOut()` → listener → `UNAUTHENTICATED` → `AUTH_READY`.
- Duplicate OTP tap: second request blocked by lock (`auth/duplicate-request`).
- No navigation changes in Phase 2.
