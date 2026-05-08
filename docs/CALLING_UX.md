# Calling UX (voice / video)

This app uses **Firestore** for call state + signaling, **WebRTC** for media, **FCM** (Android) and **VoIP push + CallKit** (iOS) for wake-from-background.

## End-to-end flow

1. **Caller** `createCall()` → document `calls/{callId}` with `status: ringing`, `type`, `callerId`, `receiverId`, optional `chatId`.
2. **Cloud Function** `callPush` on create sends:
   - Android: FCM **data-only** + high priority (`type: incoming_call`, `callId`, …), TTL 30s. No top-level `notification` — `GywFirebaseMessagingService` replaces RN Firebase’s empty `onMessageReceived`, posts `GywIncomingCallNotifier` (channel `gyw_calls_v5`, full-screen intent when locked/asleep), starts `GywIncomingCallService` as a **phone-call foreground service**, and **`GywIncomingCallAlerts`** plays the **system ringtone + vibrator** explicitly (OEMs often mute notification-only alerts). The legacy `c2dm` broadcast receiver is not used for delivery.
   - iOS: **VoIP** push to PushKit token; native code shows **CallKit** (`react-native-callkeep` + `GywVoIPPushDelegate`).
3. **Callee** (no separate incoming-call modal — ringing is the full **`/(home)/call/[id]`** screen with accept / decline):
   - Foreground/background: Firestore query in `app/(home)/_layout.tsx` (`receiverId == uid`, `status == ringing`) → navigate to `/(home)/call/[id]`.
   - Killed / background (Android): `GywFirebaseMessagingService` uses **`PowerManager.isInteractive()`**: **screen off** → full-screen notification + wake lock + `startActivity(gyw://call/{id})` for the in-app call UI; **screen on** (e.g. user in another app) → **heads-up call notification only** (ring + vibrate + tap to open) — no forced full-screen activity. Deep link is **`gyw://call/<callId>`** (host `call`, path `/<id>`). `MainActivity` defers battery / full-screen **settings** prompts when opened via that link.
   - Foreground FCM without banner: `onMessage` for `incoming_call` mirrors the listener.
4. **Callee accepts** → `updateCallStatus('active')` → WebRTC answer path in `WebRTCService` + `callSignaling/{callId}/messages`.
5. **Callee declines** → `updateCallStatus('rejected')` + signaling `hangup`; lock-screen reject can use callable `rejectCallAnon`.
6. **Missed** → no answer before timeout (30s regular) or server `markStaleRingingCallsMissed`; callee gets a **local** missed-call notification (`lib/call/missedCallNotification.ts`).
7. **Busy** → if callee already has an active call session, a new ring is auto-set to `status: busy` (no second full-screen session).

## Signaling (offer / answer / ICE)

Collection: `callSignaling/{callId}/messages` (see `sendSignalingMessage` / `subscribeToSignaling` in `lib/services/callService.ts`).

- **Caller** (offerer): `getUserMedia` → `addTrack` → `createOffer` → send `{ type: 'offer', sdp }` to callee.
- **Callee**: on `offer`, `setRemoteDescription` → `createAnswer` → send `{ type: 'answer', sdp }`.
- **ICE**: both sides send `{ type: 'ice-candidate', candidate }` as candidates arrive; remote queued until remote description is set (`lib/services/webrtcService.ts`).
- **Hangup**: `{ type: 'hangup' }` to tear down.

## Native integration

| Platform | Incoming UI | Ongoing |
|----------|-------------|---------|
| **Android** | Data-only call FCM → `GywFirebaseMessagingService` + `GywIncomingCallNotifier` (full-screen intent) + `MainActivity` `showWhenLocked` / `turnScreenOn` (`plugins/withAndroidIncomingCall.js`). Full **ConnectionService** is not wired in-tree; add Telecom if you need OEM dialer–grade integration. | In-call audio uses `react-native-incall-manager`. Foreground **phone call** service permission is declared for future FGS. |
| **iOS** | VoIP push → CallKit (`lib/callkeep.ts`, native delegate). | CallKit end synced via `reportCallEnded`. |

## Permissions

- **Microphone** (voice + video): `NSMicrophoneUsageDescription` / Android `RECORD_AUDIO`.
- **Camera** (video): `NSCameraUsageDescription` / `CAMERA`.
- **Notifications**: FCM + local notifications; Android **POST_NOTIFICATIONS** (13+).
- **Android**: `USE_FULL_SCREEN_INTENT`, `FOREGROUND_SERVICE_PHONE_CALL`, `MANAGE_OWN_CALLS` (see plugin).

## Reconnect / ICE

`WebRTCService` calls `restartIce()` on transient `failed` (limited retries). Full TURN and aggressive renegotiation are not implemented here—add TURN servers for production NAT traversal.
