# Deliverable #2: State Machine Diagram for the Call Lifecycle

## Push-Driven Calling (NO CallKit / ConnectionService)

This document defines the complete state machine for the calling layer. All states are managed within the React Native app lifecycle. Incoming calls are triggered by high-priority FCM/APNs notifications.

---

## Section 1: State Dictionary

| State | Description | Entry Actions | Exit Actions | UI Mapping | Background Behavior |
|-------|-------------|---------------|--------------|------------|---------------------|
| **IDLE** | No active call. App ready to initiate or receive. | Clear call store; unsubscribe from any lingering Firestore listeners; release any held resources. | — | Chat list, call history, or previous screen. | N/A. No foreground service. |
| **OUTBOUND_RINGING** | Caller has initiated; waiting for callee to answer. | Create `/calls/{callId}` in Firestore (status: `ringing`); subscribe to `calls/{callId}` and `calls/{callId}/events`; start ringback tone (optional); show OutgoingCallScreen. | Stop ringback; cancel ring timeout; unsubscribe from Firestore; cleanup WebRTC if initialized. | OutgoingCallScreen (avatar, name, "Calling...", Cancel button). | Persists in memory. No foreground service. If app killed, caller loses UI; Firestore call remains. |
| **INBOUND_RINGING** | Callee received FCM; waiting for Accept/Decline. | Parse FCM payload; load call from Firestore; start ringtone + vibration; show IncomingCallScreen; subscribe to `calls/{callId}` (for caller cancel). | Stop ringtone + vibration; cancel notification timeout; unsubscribe from Firestore. | IncomingCallScreen (avatar, name, "Video/Audio Call", Decline / Accept). | Persists if app backgrounded (ringtone may stop on some OEMs). No foreground service yet. If app killed before tap: no UI until user taps notification. |
| **CONNECTING** | Both parties accepted; WebRTC offer/answer/ICE exchange in progress. | Write `answer` event (callee) or wait for `answer` (caller); create RTCPeerConnection; add local tracks; subscribe to `calls/{callId}/events`; show OngoingCallScreen with "Connecting..." overlay. | — | OngoingCallScreen (spinner, "Connecting to [Name]...", network quality placeholder). | Persists. Start foreground service (Android) when entering CONNECTING to protect process. iOS: background audio not yet active until media flows. |
| **CONNECTED** | WebRTC connection established; media flowing. | Set remote description; add remote ICE candidates; InCallManager.start(); start duration timer; hide "Connecting" overlay; start foreground service (Android) if not already. | — | OngoingCallScreen (duration timer, remote video/avatar, controls: mute, speaker, video, end). | **Critical:** Foreground service (Android) must be running. Background audio (iOS) keeps app alive. Both persist when app backgrounded. |
| **RECONNECTING** | ICE disconnected; attempting to re-establish within 30s. | Show "Reconnecting..." overlay; exponential backoff retry (ICE restart or new offer); start 30s countdown. | On success: transition to CONNECTED. On timeout: transition to FAILED (network_error). | OngoingCallScreen with "Reconnecting..." overlay + progress ring. | Same as CONNECTED. Foreground service / background audio active. |
| **ON_HOLD** | Call paused (optional feature). | Dim UI; show "On hold" banner; mute local mic; optionally pause remote video. | Resume: unmute, hide banner. | OngoingCallScreen with "On hold" banner + Resume button. | Same as CONNECTED. |
| **ENDED** | Call terminated (normal or user-initiated). | Update Firestore: `status: 'ended'`, `endedAt`, `duration`; write `hangup` event; close RTCPeerConnection; stop all tracks; InCallManager.stop(); stop foreground service (Android); show "Call ended • MM:SS" overlay for 3s. | After 3s: clearCall(); navigate to chat/calls tab. | CallEndedToast overlay (3s) then dismiss. | No foreground service. App may be killed after cleanup. |
| **FAILED** | Call failed due to error (network, permission, timeout, etc.). | Update Firestore: `status: 'missed'` or `'ended'`; write `hangup` event if applicable; cleanup WebRTC; InCallManager.stop(); stop foreground service; show error UI. | User dismisses or auto-dismiss after delay. | ErrorScreen or Alert: "Connection failed", "No answer", "Permission denied", etc. | No foreground service. |

---

## Section 2: Event Matrix

| Event | Source | Valid From States | Target State | Firestore Action |
|-------|--------|-------------------|--------------|------------------|
| **user_initiate_call** | User taps Call | IDLE | OUTBOUND_RINGING | Create `calls/{callId}` |
| **local_user_canceled** | User taps Cancel (caller) | OUTBOUND_RINGING | ENDED | Update status `rejected`; write `hangup` |
| **callee_accepted** | Firestore: `answer` event received | OUTBOUND_RINGING | CONNECTING | — |
| **callee_declined** | Firestore: status `rejected` | OUTBOUND_RINGING | ENDED | — (callee wrote) |
| **callee_no_answer** | Local timeout (45s) | OUTBOUND_RINGING | ENDED | Update status `missed` |
| **callee_unavailable** | Firestore write failure or immediate error | OUTBOUND_RINGING | FAILED | — or update `missed` |
| **fcm_incoming_call** | FCM payload received | IDLE (or app wake from killed) | INBOUND_RINGING | — |
| **notification_tap** | User taps FCM notification | — (app launch) | INBOUND_RINGING | Navigate to IncomingCallScreen |
| **user_accept** | User taps Accept (callee) | INBOUND_RINGING | CONNECTING | Write `answer` event; update status `active` |
| **user_decline** | User taps Decline (callee) | INBOUND_RINGING | ENDED | Update status `rejected`; write `hangup` |
| **notification_timeout** | Local timeout (45s) or Cloud Function | INBOUND_RINGING | ENDED | Update status `missed` (if caller) |
| **caller_canceled** | Firestore: status `ended`/`rejected` | INBOUND_RINGING | ENDED | — (caller wrote) |
| **ice_connected** | WebRTC: `iceconnectionstatechange` → `connected` | CONNECTING | CONNECTED | Update status `active` (if not already) |
| **ice_disconnected** | WebRTC: `iceconnectionstatechange` → `disconnected`/`failed` | CONNECTED, RECONNECTING | RECONNECTING | — |
| **reconnect_success** | ICE re-established | RECONNECTING | CONNECTED | — |
| **reconnect_timeout** | 30s elapsed in RECONNECTING | RECONNECTING | FAILED | Update status `ended`; write `hangup` |
| **user_end_call** | User taps End | CONNECTED, RECONNECTING, ON_HOLD | ENDED | Update status `ended`; write `hangup` |
| **remote_hangup** | Firestore: `hangup` event or status `ended` | CONNECTING, CONNECTED, RECONNECTING, ON_HOLD | ENDED | — |
| **webrtc_init_failed** | Media devices unavailable | CONNECTING | FAILED | Update status `ended` |
| **signaling_timeout** | No offer/answer within 15s | CONNECTING | FAILED | Update status `ended`; write `hangup` |
| **permission_denied** | Mic/camera revoked mid-call | CONNECTED | FAILED (or continue video-only) | Update status `ended` |
| **app_background** | OS: app backgrounded | CONNECTED, RECONNECTING, ON_HOLD | (same) | — (ensure foreground service running) |
| **conflicting_incoming** | FCM while already in call | OUTBOUND_RINGING, CONNECTING, CONNECTED | (same) | Reject new call; notify caller "Busy" |
| **media_toggle** | User toggles mute/video | CONNECTED | CONNECTED | — (local only) |
| **switch_audio_route** | User switches speaker/bluetooth | CONNECTED | CONNECTED | — (InCallManager) |

---

## Section 3: Mermaid JS Diagram

```mermaid
stateDiagram-v2
    direction TB

    [*] --> IDLE

    IDLE --> OUTBOUND_RINGING : user_initiate_call
    IDLE --> INBOUND_RINGING : fcm_incoming_call / notification_tap

    state OUTBOUND_RINGING {
        direction TB
        note right of OUTBOUND_RINGING : Caller: OutgoingCallScreen\nFirestore: calls/{id} created\nCloud Function sends FCM to callee
    }
    OUTBOUND_RINGING --> ENDED : local_user_canceled
    OUTBOUND_RINGING --> ENDED : callee_declined
    OUTBOUND_RINGING --> ENDED : callee_no_answer [45s timeout]
    OUTBOUND_RINGING --> FAILED : callee_unavailable
    OUTBOUND_RINGING --> CONNECTING : callee_accepted [answer event]

    state INBOUND_RINGING {
        direction TB
        note right of INBOUND_RINGING : Callee: IncomingCallScreen\nNote: iOS cannot wake UI without tap.\nApp killed → user must tap notification.
    }
    INBOUND_RINGING --> ENDED : user_decline
    INBOUND_RINGING --> ENDED : notification_timeout [45s]
    INBOUND_RINGING --> ENDED : caller_canceled
    INBOUND_RINGING --> CONNECTING : user_accept [write answer event]

    state CONNECTING {
        direction TB
        note right of CONNECTING : Both: OngoingCallScreen "Connecting..."\nSDP/ICE exchange via Firestore events\nStart foreground service (Android)
    }
    CONNECTING --> CONNECTED : ice_connected
    CONNECTING --> FAILED : webrtc_init_failed
    CONNECTING --> FAILED : signaling_timeout [15s]
    CONNECTING --> ENDED : remote_hangup

    state CONNECTED {
        direction TB
        note right of CONNECTED : Both: OngoingCallScreen\nForeground service (Android)\nBackground audio (iOS)\nmedia_toggle, switch_audio_route = same state
    }
    CONNECTED --> RECONNECTING : ice_disconnected
    CONNECTED --> ENDED : user_end_call
    CONNECTED --> ENDED : remote_hangup
    CONNECTED --> ON_HOLD : user_hold [optional]
    CONNECTED --> FAILED : permission_denied

    state RECONNECTING {
        direction TB
        note right of RECONNECTING : Max 30s retry\nExponential backoff\nProgress ring UI
    }
    RECONNECTING --> CONNECTED : reconnect_success
    RECONNECTING --> FAILED : reconnect_timeout [30s]
    RECONNECTING --> ENDED : user_end_call

    state ON_HOLD {
        direction TB
        note right of ON_HOLD : Optional feature\nDimmed UI, Resume button
    }
    ON_HOLD --> CONNECTED : user_resume
    ON_HOLD --> ENDED : user_end_call

    state ENDED {
        direction TB
        note right of ENDED : "Call ended • MM:SS" overlay 3s\nCleanup: WebRTC, IncallManager\nStop foreground service
    }
    ENDED --> IDLE : clearCall [after 3s]

    state FAILED {
        direction TB
        note right of FAILED : network_error, permission_denied\ncallee_unavailable, signaling_timeout\nShow error UI, cleanup
    }
    FAILED --> IDLE : user_dismiss

    note right of IDLE
        Source of Truth: Firestore calls/{id}.status
        Final ended: First party to end writes status + hangup event
    end note
```

---

## Section 4: Critical Path Walkthrough

### 4.1 Happy Path: Caller Initiates → Callee Accepts → Connected → Ended

1. **IDLE → OUTBOUND_RINGING (Caller)**
   - User taps Call in chat. App creates `/calls/{callId}` with `callerId`, `calleeId`, `callType`, `status: 'ringing'`, `createdAt`.
   - Cloud Function triggers, sends FCM to callee.
   - Caller subscribes to `calls/{callId}` and `calls/{callId}/events`. OutgoingCallScreen shows "Calling [Name]...".

2. **IDLE → INBOUND_RINGING (Callee)**
   - **Foreground:** FCM `onMessage` fires; app shows IncomingCallScreen.
   - **Background:** FCM wakes app (or user taps notification); `getLastNotificationResponseAsync` or `onNotificationResponseReceived` provides `call_id`; app navigates to IncomingCallScreen.
   - **Killed:** User taps notification → OS launches app → `getLastNotificationResponseAsync()` returns payload → navigate to `/(home)/incoming-call/[callId]`. IncomingCallScreen loads call from Firestore, starts ringtone.
   - Callee sees avatar, name, "Video Call", Decline / Accept.

3. **INBOUND_RINGING → CONNECTING (Callee)**
   - User taps Accept. App writes `answer` event to `calls/{callId}/events` with SDP answer. Updates `calls/{callId}` status to `active`.
   - Callee creates RTCPeerConnection, adds tracks, sets remote description from offer (already received via Firestore listener), creates answer, sends it.
   - Navigate to OngoingCallScreen with "Connecting..." overlay.

4. **OUTBOUND_RINGING → CONNECTING (Caller)**
   - Firestore listener receives `answer` event. Caller sets remote description, adds remote ICE candidates.
   - Caller navigates to OngoingCallScreen (or was already there with "Calling...").

5. **CONNECTING → CONNECTED (Both)**
   - WebRTC `iceconnectionstatechange` → `connected`. Both hide "Connecting" overlay.
   - InCallManager.start(). Foreground service started (Android). Duration timer starts.
   - OngoingCallScreen shows remote video/avatar, controls.

6. **CONNECTED → ENDED (Either)**
   - User taps End. App updates Firestore: `status: 'ended'`, `endedAt`, `duration`. Writes `hangup` event.
   - Other party's Firestore listener sees status change (or `hangup` event) → transition to ENDED.
   - Both: close PeerConnection, stop tracks, InCallManager.stop(), stop foreground service. Show "Call ended • 12:34" for 3s, then IDLE.

### 4.2 Error Path: Network Loss During Connect

1. **CONNECTING** — Caller and callee exchanging SDP/ICE. Network drops (e.g. Wi‑Fi to cellular handoff).

2. **ice_disconnected** — WebRTC `iceconnectionstatechange` → `disconnected` or `failed`.

3. **CONNECTING → RECONNECTING** — App shows "Reconnecting..." overlay. Start 30s timer. Attempt ICE restart (create new offer, write to Firestore).

4. **RECONNECTING → CONNECTED** — If ICE re-establishes within 30s: hide overlay, resume.

5. **RECONNECTING → FAILED** — If 30s elapses: update Firestore `status: 'ended'`, write `hangup`. Show "Call disconnected • Tap to retry". Cleanup. Transition to IDLE on dismiss.

---

## Section 5: Implementation Notes

### 5.1 State Synchronization & Source of Truth

**Source of truth:** Firestore `/calls/{call_id}` document `status` field.

- **Local WebRTC state** (e.g. `iceconnectionstate`) drives CONNECTING ↔ CONNECTED ↔ RECONNECTING.
- **Firestore status** drives ENDED: when either party writes `status: 'ended'` or `'rejected'` or `'missed'`, the other party's listener updates local state to ENDED.
- **Hangup event:** Either party can write `hangup` to `calls/{callId}/events`. The other party's listener treats it as `remote_hangup` → ENDED.
- **Cleanup:** First party to end writes `status` and `hangup`. Second party reacts to Firestore update. No need for both to write; idempotent updates (e.g. `status: 'ended'` overwrite) are fine.

**State drift:** If caller thinks CONNECTED but callee has ENDED (e.g. callee force-quit):
- Callee's Firestore update may not have been sent. Use Cloud Function scheduled job to mark calls `status: 'ended'` when no heartbeat for N minutes.
- Caller's Firestore listener will eventually see status change if callee wrote. If not, caller's ICE state may go `disconnected` → RECONNECTING → FAILED.

### 5.2 App Killed → Notification Wake → Call Accept

| Step | What Happens |
|------|--------------|
| 1 | App is killed. No process. |
| 2 | FCM delivered. Notification appears on lock screen / notification shade. |
| 3 | User taps notification. OS launches app with notification payload. |
| 4 | App root (`_layout.tsx`) mounts. Call `Notifications.getLastNotificationResponseAsync()` in `useEffect`. |
| 5 | If `response?.data?.type === 'incoming_call'`, extract `call_id`, navigate to `/(home)/incoming-call/[callId]`. |
| 6 | IncomingCallScreen mounts. Load call from Firestore. If status still `ringing`, show UI. If `ended`/`rejected`, show "Call ended" and go back. |
| 7 | User taps Accept. Write `answer` event. Navigate to `/(home)/call/[id]?accept=1`. |
| 8 | CallScreen mounts. Initialize WebRTC, subscribe to events. Proceed to CONNECTING → CONNECTED. |

**Pitfall:** `getLastNotificationResponseAsync` may return `null` if app was launched by other means (e.g. icon tap). Check on every cold start; if null, no incoming call to show.

### 5.3 Android Activity Recreation

- **Scenario:** User rotates device or system reclaims memory during call. Activity is destroyed and recreated.
- **Mitigation:** Store `callId`, `callPhase` in Zustand (persisted or in-memory). On CallScreen mount, if `callPhase === 'connected'` and `callId` exists, re-attach to existing WebRTC session (peerConnection, streams) from a singleton service. Do not create a new PeerConnection.
- **Foreground service:** Survives activity death. When activity recreates, bind to service or read state from store.

### 5.4 iOS Suspend & Timers

- **Pitfall:** `setTimeout` / `setInterval` may be throttled when app is backgrounded. A 45s ring timeout might not fire accurately.
- **Mitigation:** Use `AppState` listener. When app goes to background, record `backgroundedAt`. When app returns to foreground, check if `Date.now() - backgroundedAt > ringTimeoutSec` and treat as timeout.
- **Alternative:** Rely on Cloud Function to mark `missed` after 45s. Client can still run local timeout when in foreground.

### 5.5 Battery Saver (Android)

- **Pitfall:** `PowerManager.isPowerSaveMode()` can cause background restrictions. Foreground service helps but is not always exempt.
- **Mitigation:** On CONNECTING entry, check `isPowerSaveMode`. If true, show warning toast: "Battery saver may interrupt calls." Reduce video framerate to 15fps when in battery saver.

### 5.6 Conflicting Call (Already in Call)

- **Incoming while OUTBOUND_RINGING:** Ignore new FCM or show "End current call to answer?" Modal: End current → transition current to ENDED → then handle new incoming.
- **Incoming while CONNECTED:** Same. Show modal. If user accepts, end current call, then navigate to IncomingCallScreen for new call.
- **Server-side:** Cloud Function can check if callee has active call (e.g. `calls` where `calleeId == X` and `status == 'active'`). If so, don't send FCM; instead update caller's call to `rejected` with reason "User busy".

### 5.7 Firestore Rules Alignment

Your current rules use `receiverId`. Deliverable #1 migrates to `calleeId`. For the state machine:

- **Create:** Caller writes `calls/{callId}` with `callerId`, `calleeId` (or `receiverId` during transition), `callType`, `status`, `createdAt`.
- **Update:** Caller or callee can update when `request.auth.uid` is `callerId` or `calleeId`/`receiverId`.
- **Events:** `calls/{callId}/events/{eventId}` — allow create if user is caller or callee. Ensure rules reference the correct field name (`receiverId` vs `calleeId`) to match your schema.

---

## Integration with Deliverable #1

| Deliverable #1 Component | State Machine Alignment |
|--------------------------|-------------------------|
| Firestore `/calls/{call_id}/events` | All signaling (offer, answer, ice-candidate, hangup) written as events. State transitions triggered by Firestore listeners. |
| FCM payload `type: "incoming_call"` | Triggers `fcm_incoming_call` → INBOUND_RINGING. `call_id` used for navigation. |
| Foreground service (Android) | Started on CONNECTING entry; stopped on ENDED/FAILED exit. |
| Background audio (iOS) | InCallManager.start() on CONNECTED; keeps app alive when backgrounded. |
| Critical Alerts (iOS) | Improves wake reliability for INBOUND_RINGING when app killed. No state change. |

---

*End of Deliverable #2. Proceed to Deliverable #3 (Platform-Specific Notification Configuration) when ready.*
