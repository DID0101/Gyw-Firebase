# Network Investigation & Audit Toolkit

Dev-only diagnostics for tracking idle mobile data usage in the React Native + Firebase chat app.

**Production:** All modules are gated with `if (__DEV__)` and load via dynamic `require` in `lib/appInit.ts`. They are not active in release builds.

**Metro filter:** `NET_AUDIT`

---

## Modules

| Module | File | What it tracks |
|--------|------|----------------|
| Listener tracker | `ListenerTracker.ts` | Firestore `onSnapshot` attach/detach, snapshot volume, leak warnings |
| Web Firestore patch | `WebFirestoreListenerAudit.ts` | Wraps `firebase/firestore` `onSnapshot` |
| Native Firestore patch | `NativeFirestoreListenerAudit.ts` | Wraps `@react-native-firebase/firestore` `onSnapshot` |
| Native snapListen | `lib/firestoreNative.ts` | Internal listeners via `snapListen()` |
| Network payload monitor | `NetworkPayloadMonitor.ts` | Global `fetch` sizes by URL + screen + hour |
| Firestore connection monitor | `FirebaseConnectionMonitor.ts` | NetInfo reconnect storms, cache vs server snapshot ratio |
| Presence audit | `PresenceAudit.ts` + `FirebaseWriteAudit.ts` | `lastActive`, `isOnline`, typing, queue heartbeat, live location writes |
| Timer scanner | `TimerScanner.ts` | `setInterval` / `setTimeout` — flags intervals &lt; 5s |
| Background task audit | `BackgroundTaskAudit.ts` | Headless tasks, expo-task-manager, background-fetch (if installed) |
| Image cache profiler | `ImageCacheProfiler.ts` | `expo-image` prefetch/load + `AppImage` renders |
| RTDB audit | `RtdbListenerAudit.ts` | Optional — only if RTDB package is present |
| Screen context | `NetworkAuditScreenTracker.tsx` | Current route for grouping logs |
| Audit reports | `auditReport.ts` | Periodic rollups + manual globals |

---

## Quick start

```bash
# From repo root (Windows)
.\scripts\network-audit-watch.ps1

# Or
npm run android   # USB device
# Metro console filter: NET_AUDIT
```

On app boot you should see:

```
[NET_AUDIT][REPORT] INIT_COMPLETE ...
[NET_AUDIT][REPORT] AUDIT_TOOLKIT_READY {"filter":"NET_AUDIT",...}
```

---

## Idle data leak test protocol

1. Sign in and open the **Chats** tab.
2. **Do not** open any chat, play stories, or send messages.
3. Leave the app in the foreground for **5–10 minutes**.
4. Optionally background the app for 2 minutes, then return.
5. In Metro (filter `NET_AUDIT`) or React Native debugger, run:

```js
global.__GYW_AUDIT_REPORT()
```

Other helpers:

```js
global.__GYW_AUDIT_LISTENERS()  // active Firestore listeners
global.__GYW_AUDIT_NETWORK()    // hourly fetch totals by URL/screen
global.__GYW_AUDIT_TIMERS()     // uncleared intervals/timeouts
global.__GYW_AUDIT_PRESENCE()   // presence writes in last 60s
```

---

## What to look for (smoking guns)

### 1. Listener leaks — `[NET_AUDIT][LISTENER]`

| Log | Meaning |
|-----|---------|
| `LISTENER_ATTACH` | New `onSnapshot` started |
| `LISTENER_DETACH` | Listener cleaned up |
| `LISTENER_SNAPSHOT` | Data received (every 1st and every 25th event) |
| `LISTENER_LEAK_SUSPECT` | **Warning:** listener still active **60s+ after screen unmounted** |

**Red flag:** Many `LISTENER_LEAK_SUSPECT` on paths like `chats/.../messages` while sitting on Chats list.

### 2. Network payload — `[NET_AUDIT][NETWORK]`

| Log | Meaning |
|-----|---------|
| `FETCH` | Each HTTP request with `req` / `res` / `total` sizes |
| `LARGE_PAYLOAD` | **Warning:** single request &gt; 512 KB |
| `TOP_NETWORK_CONSUMERS` | Hourly rollup (auto every 5 min) |

**Red flag:** Repeated `firestore.googleapis.com/*` with large `res` while idle.  
**Red flag:** High totals on screen `/(home)/(tabs)/chats` without user action.

### 3. Firestore reconnect storms — `[NET_AUDIT][FIRESTORE_CONN]`

| Log | Meaning |
|-----|---------|
| `NETWORK_DISCONNECT` / `NETWORK_RECONNECT` | Device connectivity flapping |
| `FIRESTORE_RECONNECT_STORM` | **Warning:** 5+ reconnects in 60s — full listener re-sync |
| `SNAPSHOT_SOURCE_RATIO` | Cache vs server snapshot ratio (every 50 snapshots) |

**Red flag:** `FIRESTORE_RECONNECT_STORM` correlating with data spikes on metered plans.

### 4. Chatty presence — `[NET_AUDIT][PRESENCE]`

| Log | Meaning |
|-----|---------|
| `PRESENCE_WRITE` | Write to status fields (`lastActive`, `isOnline`, `typing`, etc.) |
| `HIGH_FREQUENCY_PRESENCE_UPDATES` | **Warning:** &gt; 5 writes/min for one kind while idle |

**Red flag:** `lastActive` or `typing` exceeding threshold on Chats tab (expected: ~1 `lastActive` / 5 min from home layout heartbeat).

### 5. Rogue timers — `[NET_AUDIT][TIMER]`

| Log | Meaning |
|-----|---------|
| `TIMER_INTERVAL_SET` | New `setInterval` with `delayMs` and caller stack |
| `AGGRESSIVE_INTERVAL` | **Warning:** interval &lt; 5000 ms |
| `ACTIVE_TIMERS` | Rollup of uncleared timers |

**Red flag:** Multiple `AGGRESSIVE_INTERVAL` entries while idle (e.g. 1000–3000 ms polling).

### 6. Background tasks — `[NET_AUDIT][TIMER]` (background)

| Log | Meaning |
|-----|---------|
| `HEADLESS_TASK_*` | FCM / killed-state JS tasks |
| `EXPO_TASK_*` | expo-task-manager |
| `BACKGROUND_FETCH_*` | react-native-background-fetch (if used) |

### 7. Image prefetch — `[NET_AUDIT][IMAGE]`

| Log | Meaning |
|-----|---------|
| `IMAGE_PREFETCH_BATCH` | expo-image bulk prefetch |
| `IMAGE_LOAD` / `HIGH_PRIORITY_IMAGE` | Renders in text-only screens |

**Red flag:** `IMAGE_PREFETCH` or `HIGH_PRIORITY_IMAGE` on chat list while no media is visible.

---

## Architecture

```
index.js → lib/appInit.ts → initNetworkAuditToolkit()
app/_layout.tsx → NetworkAuditScreenTracker (route context)
lib/firestoreNative.ts → snapListen() → ListenerTracker
```

Unified logger: `lib/debug/networkAudit/DebugLogger.ts`

---

## Adding manual tracking (optional)

For custom listeners not going through Firestore SDK:

```ts
import { trackNamedListenerEvent } from '@/lib/debug/networkAudit';

trackNamedListenerEvent('START', 'myCustomChannel');
// ...
trackNamedListenerEvent('STOP', 'myCustomChannel');
```

For custom presence-like writes:

```ts
import { recordPresenceWrite } from '@/lib/debug/networkAudit';

recordPresenceWrite('other', { feature: 'myFeature' });
```

---

## Interpreting a healthy idle session

- **Listeners:** 2–8 active on Chats tab (user doc, chat list, blocks, etc.) — all tied to current screen.
- **Presence:** `lastActive` ≤ 1 write per 5 minutes; no `typing` writes while idle.
- **Network:** Small Firestore channel traffic; no `LARGE_PAYLOAD` warnings.
- **Timers:** No `AGGRESSIVE_INTERVAL`; 5-minute presence interval from home layout is OK.
- **Reconnects:** 0–1 per session; no `FIRESTORE_RECONNECT_STORM`.

Any sustained deviation from the above while idle is a lead for the root-cause fix phase.
