# Minimal-Mode Failure Evidence — Extraction & Classification

---

## VISIBILITY PROOF TEST (Current Mode)

**Enabled:** `VISIBILITY_PROOF_MODE = true` in `functions/src/index.ts`

The function now **only** fetches `randomQueue` and returns `{ visibleQueueSize, visibleDocIds }`. No matching, no transaction.

### Test protocol
1. Deploy: `firebase deploy --only functions`
2. Device A: Start search, wait 3 seconds
3. Device B: Start search
4. Device A: tryMatch runs (from discover retry loop) → check response
5. Device B: tryMatch runs → check response

### Where to get results
- **Device logs (Metro):** `[DiscoverAudit] tryMatch_callable visibility_proof` with `visibleQueueSize`, `visibleDocIds`
- **Firebase Console → Functions → Logs:** `[tryRandomMatch:VISIBILITY_PROOF] RESULT` with `totalDocs`, `docIds`, `docDataList`

### Interpretation
| Device A sees | Device B sees | Meaning |
|---------------|---------------|---------|
| 2 docs | 2 docs | Firestore visibility OK → transaction logic is broken |
| 1 doc (self) | 1 doc (self) | Different Firestore instances or projects |
| 2 docs | 1 doc | One device misconfigured (SDK/project mismatch) |

---

**Purpose:** Classify the exact failure mode from Cloud Function logs. No fixes proposed.

---

## Step 1 — Log Extraction Template

Paste Firebase Console → Functions → Logs for the time window when **both devices** were searching. Extract:

### Device A (callerUid: _____________)

| Field | Value |
|-------|-------|
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` → totalDocs | |
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` → waitingDocs | |
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` → docIds | |
| `[tryRandomMatch:MINIMAL] NO_MATCH` → reason | |
| `[tryRandomMatch:MINIMAL] CANDIDATE_SELECTED` → candidateUid | |
| `[tryRandomMatch:MINIMAL] TRANSACTION_ABORTED` → abortReason | |
| `[tryRandomMatch:MINIMAL] TRANSACTION_COMMITTED` → callId | |
| `[tryRandomMatch:MINIMAL] POST_MATCH_VALIDATION` → callDocExists, callerRemovedFromQueue, otherRemovedFromQueue | |

### Device B (callerUid: _____________)

| Field | Value |
|-------|-------|
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` → totalDocs | |
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` → waitingDocs | |
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` → docIds | |
| `[tryRandomMatch:MINIMAL] NO_MATCH` → reason | |
| `[tryRandomMatch:MINIMAL] CANDIDATE_SELECTED` → candidateUid | |
| `[tryRandomMatch:MINIMAL] TRANSACTION_ABORTED` → abortReason | |
| `[tryRandomMatch:MINIMAL] TRANSACTION_COMMITTED` → callId | |
| `[tryRandomMatch:MINIMAL] POST_MATCH_VALIDATION` → callDocExists, callerRemovedFromQueue, otherRemovedFromQueue | |

---

## Step 2 — Classification Logic

### Category A) Queue visibility issue (one device not visible)

**Evidence:**
- At least one invocation has `QUEUE_SIZE.waitingDocs === 1` and `docIds` contains only that caller's UID
- The other device's UID is never present in any `docIds` across both devices' invocations
- `NO_MATCH` reason = `no_other_candidate`

**Interpretation:** One device's queue document is not visible to the Cloud Function. Writes and reads use different Firestore instances or projects.

---

### Category B) Status mismatch issue (not both "waiting")

**Evidence:**
- `QUEUE_SIZE.totalDocs >= 2` but `waitingDocs < 2`
- Or `docIds` shows 2 UIDs but `NO_MATCH` reason = `caller_not_in_queue_or_not_waiting` for one
- Filter `status === "waiting"` excludes one or both docs

**Interpretation:** One or both documents have `status !== "waiting"` when the function runs.

---

### Category C) Transaction conflict issue

**Evidence:**
- `CANDIDATE_SELECTED` logged for at least one device
- `TRANSACTION_ABORTED` with `abortReason`: `other_queue_entry_no_longer_valid` or `my_queue_entry_no_longer_valid`
- `transactionAttempts > 1` (retries)
- Both devices see `CANDIDATE_SELECTED` but neither sees `TRANSACTION_COMMITTED`

**Interpretation:** Both try to match each other; one transaction commits, the other aborts. Or repeated aborts due to concurrent modifications.

---

## Step 3 — Output Format (fill after log review)

```
OBSERVED VALUES
---------------
Device A callerUid: 
Device B callerUid: 
Device A QUEUE_SIZE: totalDocs=___, waitingDocs=___, docIds=[...]
Device B QUEUE_SIZE: totalDocs=___, waitingDocs=___, docIds=[...]
Device A NO_MATCH reason (if any): 
Device B NO_MATCH reason (if any): 
Device A CANDIDATE_SELECTED: 
Device B CANDIDATE_SELECTED: 
Device A TRANSACTION_ABORTED: 
Device B TRANSACTION_ABORTED: 
Device A TRANSACTION_COMMITTED: 
Device B TRANSACTION_COMMITTED: 

CATEGORY
--------
[ ] A) Queue visibility issue
[ ] B) Status mismatch issue  
[ ] C) Transaction conflict issue

EXACT EVIDENCE FROM LOGS
------------------------
(paste or quote specific log lines)

CONFIDENCE LEVEL
----------------
[ ] High — evidence clearly supports category
[ ] Medium — evidence mostly supports, some ambiguity
[ ] Low — insufficient or conflicting evidence
```

---

## Codebase Analysis — Dual Firestore / Project Mismatch Vectors

### 1. Two Firestore paths in randomMatchService

| Path | When used | Source |
|------|-----------|--------|
| **RN Firebase** | `hasNativeFirestore === true` (native Android/iOS) | `@react-native-firebase/firestore` → `getFirestore()` |
| **Web SDK** | `hasNativeFirestore === false` (web, or RN Firebase failed to load) | `lib/firebase.ts` → `getFirestore(app)` |

**joinQueue, updateQueueHeartbeat, leaveQueue, listenForIncomingRandomCall** use the path above.

**tryMatch** on native uses REST + idToken from RN Firebase Auth; the Cloud Function uses Admin SDK (project = function deployment project).

### 2. Project configuration sources

| Source | Project ID | Used by |
|--------|------------|---------|
| `google-services.json` | `gyw1-146d7` | RN Firebase (Android) |
| `lib/firebase.ts` firebaseConfig | `gyw1-146d7` | Web SDK |
| Cloud Function URL | `us-central1-gyw1-146d7.cloudfunctions.net` | tryMatch callable |

**Current codebase:** All point to `gyw1-146d7`.

### 3. Likely causes of “one device not visible” (Category A)

| Cause | How to verify |
|-------|----------------|
| **Different Firestore instances** | One device uses Web SDK, one uses RN Firebase, and they resolve to different projects (e.g. env override, build config). |
| **Different Firebase project between builds** | Device A build uses project X (e.g. old google-services.json), Device B uses project Y. Check `google-services.json` and `GoogleService-Info.plist` in each build. |
| **EAS / build flavor mismatch** | Different `google-services.json` per build flavor (dev/staging/prod). |
| **RN Firebase load failure** | `hasNativeFirestore === false` on one device → falls back to Web SDK. If Web SDK app is misconfigured, writes go to wrong project. |

### 4. Client log check for SDK path

In device logs, look for `[DiscoverAudit]`:

- `"sdk":"RN_Firebase"` → using React Native Firebase
- `"sdk":"Web_SDK"` → using Web SDK
- `"sdk":"RN_REST"` → tryMatch uses REST (auth from RN Firebase)

If one device shows `Web_SDK` for joinQueue/heartbeat and the other `RN_Firebase`, they may be writing to different Firestore instances.

---

## Expected 90% Case

Based on similar setups, the most common causes are:

1. **Different Firestore instances** — one device still using Web SDK somewhere (e.g. `hasNativeFirestore` false, or a code path that uses `db` from firebase.ts instead of RN Firebase).
2. **Different Firebase project between builds** — Device A and Device B built with different `google-services.json` / `GoogleService-Info.plist` or env overrides.

**Next step after classification:** If Category A, audit all Firestore usage for Discover and ensure both devices use the same project and the same SDK path (RN Firebase vs Web).
