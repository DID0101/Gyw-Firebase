# Poor Network Reliability Architecture

Production hardening for 2G/Edge, high latency (500–3000ms), packet loss, and intermittent connectivity.

## Architecture

```mermaid
flowchart TB
  subgraph UI
    SignUp[sign-up.tsx]
    SignIn[sign-in.tsx]
    Chat[chat/id.tsx]
    Search[find-by-username.tsx]
  end

  subgraph Reliability["lib/reliability/"]
    NM[NetworkManager]
    RM[RetryManager]
    RQ[RequestMonitor]
    OQ[OfflineQueue]
    RL[reliabilityLog]
  end

  subgraph Offline["lib/offline/"]
    MO[messageOutbox]
    JQ[jobQueue]
  end

  subgraph Auth["lib/auth/"]
    PS[pendingSignupState]
    PL[pendingLoginState]
    PW[userProfileWrite]
  end

  NM --> NetInfo[@react-native-community/netinfo]
  RM --> SN[safeNetwork.withNetworkSafety]
  SignUp --> PS
  SignUp --> PW
  SignIn --> PL
  Chat --> MO
  MO --> RM
  OQ --> AsyncStorage[(AsyncStorage)]
  MO --> AsyncStorage
  PS --> AsyncStorage
  PW --> Firestore[(Firestore)]
  JQ --> CloudFns[Cloud Functions gywAi*]
  initReliability --> NM
  initReliability --> OQ
```

## New modules

| File | Role |
|------|------|
| `lib/reliability/NetworkManager.ts` | Online/offline, latency probes, quality tiers, offline duration |
| `lib/reliability/RetryManager.ts` | Exponential backoff wrapper; slow-network tuning |
| `lib/reliability/RequestMonitor.ts` | Request duration + failure logging |
| `lib/reliability/OfflineQueue.ts` | Generic durable queue with reconnect flush |
| `lib/reliability/reliabilityLog.ts` | `[NETWORK]` `[AUTH]` `[QUEUE]` etc. |
| `lib/reliability/initReliability.ts` | Bootstrap all subsystems |
| `lib/auth/pendingSignupState.ts` | OTP/signup survives app kill |
| `lib/auth/pendingLoginState.ts` | Login OTP state persistence |
| `lib/auth/userProfileWrite.ts` | Profile writes with retry + queue |
| `lib/offline/jobQueue.ts` | Cloud Function job queue (AI, future audiobook) |
| `lib/services/searchCache.ts` | Stale-while-revalidate search cache |

## Structured logs

Filter device logs:

```bash
adb logcat *:S ReactNativeJS:V | findstr /i "NETWORK REQUEST RETRY QUEUE AUTH FIRESTORE UPLOAD SYNC"
```

## Signup / login

- **Offline preflight** before OTP send (`assertOnlineForOperation`)
- **Retry + timeout** on `sendPhoneOTP` / `confirmPhoneOTP` (`retryAuthOperation`, 45s timeout, 4 attempts)
- **Persist OTP state** to AsyncStorage (signup + login)
- **Duplicate account guard** — skip `writeUserDoc` if profile already exists
- **Profile write queue** — failed Firestore profile writes enqueued and flushed on reconnect
- **Username check fail-closed** on network error (`checkUsernameAvailableStrict`)
- **Auth layout** — network errors no longer force `profileComplete = false`

## Chat

- Text messages: optimistic UI + `messageOutbox` (existing) now uses `RetryManager` + `[QUEUE]` logs
- Media uploads: still upload-then-write; **media outbox not yet implemented** (see gaps)

## Search

- 300ms debounce (existing)
- **Stale-while-revalidate** via `searchCache.ts` (10 min TTL)

## Cloud jobs (AI / audiobook-ready)

- Failed `gywAiReplyV1` / `gywAiMultimodalV1` calls enqueued to `cloud_function_job` queue
- Flushed automatically on reconnect
- Audiobook pipeline: use same `jobQueue` pattern when implemented

## Firebase configuration

No Firebase Console changes required. Existing setup:

- Native Firestore offline persistence (RN Firebase default)
- Web: `persistentLocalCache` in `lib/firebase.ts`
- Auth persistence: default (native + web)

## Remaining gaps (prioritized)

1. **Media upload outbox** — resumable Storage uploads after disconnect/restart
2. **Chunked/resumable uploads** — Firebase Storage resumable API or tus
3. **Delivered receipts** — requires server-side or read-receipt pipeline
4. **Audiobook generation** — not in codebase; wire to `jobQueue` when added
5. **Firestore write latency metrics** — hook `userProfileWrite` pattern into all critical writes

## Performance targets

Designed for:

- 2G / Edge (`NetworkManager.quality === 'poor'` → longer timeouts, more retries)
- 500–3000ms RTT (latency probe every 45s)
- Intermittent disconnects (offline queues + reconnect flush)

## Initialization

Called from `lib/appInit.ts` and `app/(home)/_layout.tsx` via `initReliability()`.
