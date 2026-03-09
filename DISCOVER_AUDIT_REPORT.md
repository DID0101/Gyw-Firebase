# Discover Permission-Denied Root Cause Audit Report

## STEP 1 — Exact Failure Origin (Instrumentation Added)

**Structured logging added to:**
- `joinQueue` (setDoc to randomQueue/{uid}) — before, after, error with `errorCode`, `errorMessage`
- `updateQueueHeartbeat` (updateDoc) — before, error
- `leaveQueue` (deleteDoc) — before, error
- `tryMatch` (callable) — before, after, error with `errorCode`, `errorMessage`
- `listenForIncomingRandomCall` (onSnapshot on calls) — before, after, error with `errorCode`, `errorMessage`

**Each log includes:**
- `projectId` (from app.options.projectId)
- `sdk`: `RN_Firebase` or `Web_SDK`
- `nativeAuthUid`: `auth().currentUser?.uid` from @react-native-firebase/auth (native only)

**How to use:** Run app, press Start, check Metro console for `[DiscoverAudit]` lines. The last `phase: "error"` line identifies the failing operation.

---

## STEP 2 — Auth State Timing

**Changes made:**
- Discover now uses `authLoading` from `useAuth()`
- `startSearch` returns early if `authLoading` is true
- Start button is `disabled={authLoading}` to prevent presses before auth hydrates
- Log `authLoading` in startSearch when __DEV__

**Auth flow:** AuthContext uses `nativeAuth().onAuthStateChanged` on native. First callback sets `loading: false`. No operation runs before that.

---

## STEP 3 — Project Consistency

**Verified:**
- `google-services.json`: `project_id: "gyw1-146d7"` ✓
- `lib/firebase.ts`: `projectId: "gyw1-146d7"` ✓
- Firebase Console rules deployed to `gyw1-146d7` ✓

**Functions region:** Default (us-central1). No emulator connection in production code.

---

## STEP 4 — Callable Auth Context

**Cloud Function logging added:**
```javascript
functions.logger.info("[tryRandomMatch] auth context", {
  hasAuth: !!context.auth,
  authUid: context.auth?.uid ?? null,
});
```

**How to check:** Deploy functions, trigger Discover, view Firebase Console → Functions → Logs. If `hasAuth: false` → client request is unauthenticated (auth token not sent).

---

## STEP 5 — Firestore Rules

**randomQueue rules:**
```
match /randomQueue/{queueId} {
  allow create, update, delete: if request.auth != null && request.auth.uid == queueId;
  allow read: if request.auth != null && request.auth.uid == queueId;
}
```

**Client path:** `randomQueue/{userId}` where `userId === request.auth.uid` ✓

**No nested path.** No `request.resource.data` conditions that could fail on create.

---

## STEP 6 — SDK Mixing Audit

**Discover flow (randomMatchService):**
- `joinQueue`, `updateQueueHeartbeat`, `leaveQueue`: Uses RN Firebase when `hasNativeFirestore` (native)
- `listenForIncomingRandomCall`: Uses RN Firebase when native
- `tryMatch`: Uses `@react-native-firebase/functions` when native (fallback to web SDK on error)

**Web SDK imports still present in randomMatchService:** `firebase/firestore` (doc, setDoc, etc.) — used only when `!hasNativeFirestore` (web platform).

**Other files using firebase/ (web SDK) on native:**
- `lib/notifications.ts` — `setDoc` for token save (uses web db)
- `lib/services/blockReportService.ts` — addDoc to reports
- `app/(home)/_layout.tsx` — uses `rnFirestore` when `useNativeFirestore`, else web
- `lib/hooks/useStories.ts`, `useChats.ts`, `useMessages.ts`, etc. — web Firestore

**Critical:** The Discover flow uses RN Firebase for Firestore and Functions on native. No web SDK in that path when `hasNativeFirestore` is true.

---

## STEP 7 — Diagnosis Checklist

After running the app and reproducing the error, fill in:

| Item | Value |
|------|-------|
| **Exact failing operation** | _Check last `[DiscoverAudit] ... error` log_ |
| **Exact SDK used** | _sdk field in that log: RN_Firebase or Web_SDK_ |
| **nativeAuthUid at failure** | _From audit log — if null, native auth not ready_ |
| **Firebase project** | _projectId in log — should be gyw1-146d7_ |
| **error.code** | _From audit log errorCode_ |
| **Client vs Cloud Function** | _If joinQueue_setDoc error → client. If tryMatch and CF logs hasAuth:false → client auth. If CF hasAuth:true and error → inside function (unlikely — CF uses Admin SDK)_ |

---

## Five Possible Root Causes

1. **Auth not ready at write** — `nativeAuthUid: null` in joinQueue_setDoc before log → fix: auth loading gate (done)
2. **Wrong Firebase project** — projectId !== "gyw1-146d7" → config mismatch
3. **Callable without auth token** — CF log shows `hasAuth: false` → RN Functions or getFunctions(getApp()) not sending token
4. **Firestore write in CF failing rules** — CF uses Admin SDK, bypasses rules; not applicable
5. **SDK mixing** — Web SDK used where RN needed → audit shows Discover uses RN on native

---

## Next Steps

1. Run app, press Start, capture full `[DiscoverAudit]` output
2. Check Firebase Console → Functions → Logs for `[tryRandomMatch] auth context`
3. Report back: last error log line + CF auth log
