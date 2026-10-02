# Offline-First Reliability Layer

Production-grade offline-first architecture for poor networks (2G/Edge/intermittent).

## Folder structure

```
lib/reliability/
  NetworkManager.ts      # NetInfo — isOnline, connectionType, isPoorConnection, reconnect events
  StorageManager.ts      # MMKV queues (AsyncStorage fallback on web)
  RetryManager.ts        # retry(fn) — 1s/2s/4s/8s/10s backoff
  QueueSyncManager.ts    # Ordered flush on reconnect
  OfflineQueue.ts        # failedRequestsQueue (cloud jobs, etc.)
  RequestMonitor.ts      # Request duration logs
  SentryManager.ts       # Error capture + context
  reliabilityLog.ts      # [NETWORK] [QUEUE] [RETRY] [SENTRY] [FIREBASE]
  initReliability.ts     # Bootstrap

lib/offline/
  messageOutbox.ts       # pendingMessages queue
  uploadQueue.ts         # pendingUploads queue
  jobQueue.ts            # Cloud function jobs → failedRequestsQueue

lib/auth/
  signupQueue.ts         # pendingSignups queue (profile writes)
  pendingSignupState.ts  # OTP UI state (AsyncStorage)
  userProfileWrite.ts    # Reliable profile writes
```

## MMKV queues

| Queue | Storage key | Purpose |
|-------|-------------|---------|
| `pendingSignups` | `reliability:queue:pendingSignups` | Profile writes after OTP |
| `pendingMessages` | `reliability:queue:pendingMessages` | Failed text sends |
| `pendingUploads` | `reliability:queue:pendingUploads` | Failed media uploads |
| `failedRequestsQueue` | `reliability:queue:failedRequestsQueue` | Cloud jobs, generic retries |

API: `addToQueue`, `removeFromQueue`, `getQueue`, `clearQueue`

## Reconnect flush order

1. `pendingSignups` — `flushSignupQueue()`
2. `pendingMessages` — `flushMessageOutbox()`
3. `pendingUploads` — `flushUploadQueue()`
4. `failedRequestsQueue` — `flushFailedRequestsQueue()`

Single coordinator in `QueueSyncManager` prevents duplicate execution via in-flight id set.

## Retry backoff

`retry(fn, { maxRetries, timeoutMs, label })` — delays: **1s → 2s → 4s → 8s → 10s**. Only network-shaped errors retry (`isNetworkError`).

## Sentry

Set `EXPO_PUBLIC_SENTRY_DSN` in `.env` or EAS secrets.

Initialized in `index.js` before app boot. Context tags: `network.online`, `network.poor`, `userId`, `screen`.

## Integration points

| File | Change |
|------|--------|
| `index.js` | `initSentry()` first |
| `lib/appInit.ts` | `initReliability()` + unhandled rejection handler |
| `app/(home)/_layout.tsx` | `initReliability()`, `setSentryScreen(pathname)` |
| `contexts/AuthContext.tsx` | `setSentryUser(uid)` |
| `app/(auth)/sign-up.tsx` | `writeUserDocReliable` → MMKV queue on failure |
| `app/(home)/chat/[id].tsx` | `sendMediaMessageReliable` → MMKV `pendingUploads` on network failure |

## Media uploads

`sendMediaMessageReliable` in `lib/offline/mediaSendReliable.ts` wraps `sendMediaMessage`. On network failure it enqueues to `pendingUploads` and throws `MediaSendQueuedError` (user sees “queued for retry” alert).

## Dependencies

```bash
npm install react-native-mmkv @sentry/react-native
```

Rebuild native after install: `npx expo run:android`

## Logs

```bash
adb logcat *:S ReactNativeJS:V | findstr /i "NETWORK QUEUE RETRY SENTRY FIREBASE"
```
