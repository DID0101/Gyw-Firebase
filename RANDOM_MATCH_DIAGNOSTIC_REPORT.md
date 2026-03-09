# Random Matchmaking Diagnostic Report

**Purpose:** Isolate the exact failure point when two devices remain stuck in "searching" with no match created.

---

## MINIMAL MATCHING MODE (Current)

**Enabled:** `MINIMAL_MATCHING_MODE = true` in `functions/src/index.ts`  
**Cleanup disabled:** `CLEANUP_DISABLED = true`

### What is disabled
- Block checks
- Ban checks (`randomChatBannedUntil`)
- lastSeen freshness filtering
- Skip rate limits (not in tryRandomMatch)
- Gender/country/activeCall (never existed)
- cleanupRandomQueue (no stale removals)

### What remains
- Self exclusion only (`uid !== callerUid`)
- Query: all docs in randomQueue with `status === "waiting"`
- Transaction: create call, delete both from queue

### Controlled test protocol
1. **Device A:** Start search, wait 3 seconds
2. **Device B:** Start search
3. **Expected:** Match within ~5–10 seconds

### Log tags for minimal test
| Tag | Meaning |
|-----|---------|
| `[tryRandomMatch:MINIMAL] QUEUE_SIZE` | `totalDocs`, `waitingDocs`, `docIds` |
| `[tryRandomMatch:MINIMAL] CANDIDATE_SELECTED` | `candidateUid` found |
| `[tryRandomMatch:MINIMAL] TRANSACTION_COMMITTED` | Success. `callId`, `callerUid`, `receiverUid` |
| `[tryRandomMatch:MINIMAL] TRANSACTION_ABORTED` | Transaction failed. `abortReason` |
| `[tryRandomMatch:MINIMAL] POST_MATCH_VALIDATION` | `callDocId`, `callDocExists`, `callerRemovedFromQueue`, `otherRemovedFromQueue` |

### Interpretation
- **If minimal works:** Issue was in filtering or freshness logic. Restore filters one by one.
- **If minimal fails:** Issue is in transaction or write layer. Check `QUEUE_SIZE` (did query return 2 docs?), `TRANSACTION_ABORTED` (abort reason).

---

## Step 1 — tryRandomMatch Instrumentation

### Log Tags to Search in Firebase Console → Functions → Logs

| Log Tag | What It Tells You |
|---------|-------------------|
| `[tryRandomMatch:diag] INVOKED` | Function is executing. Contains: `callerUid`, `serverTimeMs`, `region`. |
| `[tryRandomMatch:diag] QUEUE_TOTAL` | Total docs in `randomQueue`. If 0 or 1, no other user in queue. |
| `[tryRandomMatch:diag] CALLER_HEARTBEAT` | Caller's `lastSeen`, age vs server, `within20sWindow`. |
| `[tryRandomMatch:diag] QUERY_RESULT` | Candidates from query, `lastSeenCutoffMs`, per-doc `lastSeenMs` and `lastSeenAgeMs`. |
| `[tryRandomMatch:diag] CANDIDATE_FILTERING` | Each excluded candidate and exact `reason`. |
| `[tryRandomMatch:diag] NO_MATCH_REASON` | Why no match: `caller_not_in_queue`, `caller_banned`, `no_valid_candidate_after_filtering`. |
| `[tryRandomMatch:diag] CANDIDATE_SELECTED` | A candidate was chosen. `selectedUid`, `otherLastSeenMs`. |
| `[tryRandomMatch:diag] TRANSACTION_ATTEMPT` | Transaction attempt number (retries = race condition). |
| `[tryRandomMatch:diag] TRANSACTION_COMMITTED` | Match succeeded. `callId`, `transactionAttempts`. |
| `[tryRandomMatch:diag] TRANSACTION_ABORTED` | Transaction failed. `abortReason`, `transactionAttempts`. |
| `[tryRandomMatch:diag] POST_MATCH_VALIDATION` | After commit: `callDocExists`, `callerRemovedFromQueue`, `otherRemovedFromQueue`. |

### Client Logs (Metro / device console, `__DEV__` only)

| Log Tag | What It Tells You |
|---------|-------------------|
| `[DiscoverAudit] joinQueue_setDoc` | Client joined queue. `clientTimeMs`, `lastSeenWrittenMs`. |
| `[DiscoverAudit] updateQueueHeartbeat` | Heartbeat sent. `lastSeenWrittenMs`, `clientTimeMs`. |
| `[DiscoverAudit] tryMatch_callable` | Before/after tryMatch. `callableRegion`, `url`. |
| `[DiscoverAudit] listenForIncomingRandomCall` | Listener fired. `docCount` when call appears. |

---

## Step 2 — Candidate Query Logic Validation

### Filtering Conditions (in order)

1. **Self excluded:** `docSnap.id === queueDocId` → `reason: "self_excluded"`
2. **No userId / same as caller:** `!otherId || otherId === userId` → `reason: "no_userId_or_same_as_caller"`
3. **Caller blocks other:** `myBlocked.includes(otherId)` → `reason: "caller_blocks_other"`
4. **Other blocks caller:** `otherBlocked.includes(userId)` → `reason: "other_blocks_caller"`
5. **Other banned:** `otherBannedUntil > now` → `reason: "other_banned"`

### Not Present (no unintentional filtering)

- No `activeCall` filter
- No `gender` filter
- No `country` filter
- No "already searching" exclusion

### lastSeen Cutoff

- **tryRandomMatch:** `lastSeen > (serverTime - 180000)` (3 minutes)
- **cleanupRandomQueue:** removes `lastSeen < (serverTime - 20000)` (20 seconds)
- **Heartbeat:** every 12 seconds

If `lastSeenAgeMs` in `QUERY_RESULT` is > 180000 for a doc, it would not appear in the query. If > 20000, cleanup may have removed it before tryRandomMatch ran.

---

## Step 3 — Heartbeat Behavior Validation

### In Cloud Function

- `CALLER_HEARTBEAT`: `lastSeenMs`, `ageSinceLastSeenMs`, `within20sWindow`
- `QUERY_RESULT`: `queryDocDetails` with `lastSeenMs` and `lastSeenAgeMs` per doc

### In Client

- `updateQueueHeartbeat`: `lastSeenWrittenMs`, `clientTimeMs`
- `joinQueue_setDoc`: `lastSeenWrittenMs` on initial join

### Interpretation

- If `ageSinceLastSeenMs` > 20000: user may have been removed by cleanup before tryRandomMatch.
- If `lastSeenAgeMs` > 180000: doc excluded by query (too stale).
- Clock skew: compare `clientTimeMs` (client) vs `serverTimeMs` (function). Large difference = clock skew.

---

## Step 4 — Race Condition Detection

### Signs of Race

1. **Multiple `TRANSACTION_ATTEMPT`** logs for same caller (attempt 2, 3, …) → transaction retried.
2. **`TRANSACTION_ABORTED`** with `abortReason: "other_queue_entry_no_longer_valid"` → other user was matched by someone else.
3. **Both devices** see `TRANSACTION_ATTEMPT` but neither sees `TRANSACTION_COMMITTED` → both trying to match each other, one aborts.

### Firestore Transaction Behavior

- `runTransaction` retries automatically on conflict.
- Only one transaction commits; others abort and retry.
- After max retries, `runTransaction` throws → we catch and return `{ matched: false }`.

---

## Step 5 — Firestore Writes After Match

### POST_MATCH_VALIDATION Log

After a successful commit:

- `callDocExists: true` → call document created
- `callerRemovedFromQueue: true` → caller removed from `randomQueue`
- `otherRemovedFromQueue: true` → other user removed from `randomQueue`

### Client Listener

- `listenForIncomingRandomCall` with `docCount: 1` → receiver got the call.
- If `callDocExists` but receiver never gets `docCount: 1` → listener query/permissions issue.

---

## Step 6 — Region Consistency

- **Function:** `region` in `INVOKED` (default `us-central1`).
- **Client:** `callableRegion: 'us-central1'`, `url` in `tryMatch_callable` before.
- Both must use same region.

---

## Step 7 — Diagnostic Checklist

After reproducing the issue and collecting logs:

| Question | Where to Look | Evidence |
|----------|---------------|----------|
| Is tryRandomMatch being invoked? | `INVOKED` logs | `callerUid`, `serverTimeMs` present |
| Are candidates found? | `QUERY_RESULT`, `CANDIDATE_FILTERING` | `candidatesFromQuery`, `excludedReasons` |
| Is transaction committing? | `TRANSACTION_COMMITTED` vs `TRANSACTION_ABORTED` | `callId` or `abortReason` |
| Are users considered stale? | `QUERY_RESULT`, `cleanupRandomQueue:diag` | `lastSeenAgeMs` > 20000 or in `staleDetails` |
| Is a race condition detected? | Multiple `TRANSACTION_ATTEMPT`, `TRANSACTION_ABORTED` | `attempt` > 1, `other_queue_entry_no_longer_valid` |
| Are Firestore writes correct? | `POST_MATCH_VALIDATION` | `callDocExists`, `callerRemovedFromQueue`, `otherRemovedFromQueue` |
| **Exact reason no match** | Combine above | See conclusions below |

---

## Conclusions (fill after log review)

### Scenario A: Query returns 0 candidates

- **Evidence:** `QUEUE_TOTAL` = 0 or 1, or `candidatesFromQuery` = 0
- **Possible causes:** Both users not in queue at same time; cleanup removing users; different Firestore project/region

### Scenario B: Query returns candidates but all filtered out

- **Evidence:** `CANDIDATE_FILTERING` with `excludedReasons` for each
- **Possible causes:** Blocking, banning, or `lastSeen`/query mismatch

### Scenario C: Candidate selected but transaction aborts

- **Evidence:** `CANDIDATE_SELECTED` then `TRANSACTION_ABORTED`
- **Possible causes:** Race (both matching each other); other user left; cleanup removed other user mid-transaction

### Scenario D: Transaction commits but client doesn't receive call

- **Evidence:** `TRANSACTION_COMMITTED`, `POST_MATCH_VALIDATION` ok, but no `listenForIncomingRandomCall` with `docCount: 1` for receiver
- **Possible causes:** Firestore rules, listener query, or client not subscribed

### Scenario E: Function not invoked

- **Evidence:** No `INVOKED` logs
- **Possible causes:** Auth/token, network, wrong URL/region, deployment

---

## How to Collect Logs

1. **Firebase Console:** Project → Functions → Logs. Filter by `tryRandomMatch` or `tryRandomMatch:diag`.
2. **Client:** Run `npx expo run:android` (or iOS), watch Metro/device logs for `[DiscoverAudit]`.
3. **Reproduce:** Both devices tap "Start Random Chat" within a few seconds. Wait 45+ seconds.
4. **Time window:** Note approximate timestamps when each device started searching.
5. **Correlate:** Match `serverTimeMs` in function logs with `clientTimeMs` in client logs.
