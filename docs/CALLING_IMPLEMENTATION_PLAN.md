# Deliverable #1: Step-by-Step Implementation Plan

## Push-Driven Calling (NO CallKit / ConnectionService)

This plan covers the complete architecture for rebuilding the calling layer using **high-priority FCM/APNs notifications** and **custom in-app screens** only. No native telecom integration. Target: **EAS Build (Custom Dev Client)** exclusively.

---

## 1. Firestore Schema & Security Rules

### 1.1 Hybrid Structure (Confirmed)

| Collection | Purpose | Trigger |
|------------|---------|---------|
| `/calls/{callId}` | Call metadata (intent, status, timestamps) | Cloud Function on **create** → FCM |
| `/callSignaling/{callId}/messages/{messageId}` | WebRTC signaling (offer, answer, ICE) | Used **only after callee accepts** |

**Rationale:** Separates high-frequency WebRTC data from static call metadata. Prevents document size limits. Call intent triggers FCM immediately; signaling begins only when callee accepts.

---

### 1.2 Main Call Document: `/calls/{callId}`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `callerId` | string | ✓ | UID of caller |
| `calleeId` | string | ✓ | UID of callee (receiver) |
| `callType` | string | ✓ | `"audio"` or `"video"` |
| `status` | string | ✓ | `ringing` \| `connecting` \| `active` \| `ended` \| `missed` \| `rejected` |
| `chatId` | string | optional | Associated chat for call log |
| `createdAt` | timestamp | ✓ | Server timestamp (startTime) |
| `updatedAt` | timestamp | optional | Last update |
| `endedAt` | timestamp | optional | When call ended (endTime) |
| `duration` | number | optional | Duration in seconds |
| `ringTimeoutSec` | number | optional | Default 45 |
| `callMetadata` | map | optional | Extensible (e.g. `isRandom`) |

**Status flow:**
- Caller creates: `status: 'ringing'`
- Callee accepts: Callee updates to `status: 'connecting'` (or `'active'`) → triggers signaling
- WebRTC connected: Either party updates to `status: 'active'`
- Call ended: Either party updates to `status: 'ended'` or `'missed'` or `'rejected'`

---

### 1.3 Signaling Collection: `/callSignaling/{callId}/messages/{messageId}`

**Used only after callee accepts.** Each message is a separate document (trickle ICE).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | ✓ | `offer` \| `answer` \| `ice-candidate` \| `hangup` |
| `from` | string | ✓ | UID of sender |
| `to` | string | ✓ | UID of recipient |
| `sdp` | object | conditional | RTCSessionDescriptionInit (for offer/answer) |
| `candidate` | object | conditional | RTCIceCandidateInit (for ice-candidate) |
| `timestamp` | timestamp | ✓ | Server timestamp |

**Message types:**
- `offer`: Caller writes first after callee updates status to `connecting`. Contains `sdp`.
- `answer`: Callee writes after receiving offer. Contains `sdp`.
- `ice-candidate`: Both sides write as candidates are gathered. Contains `candidate`.
- `hangup`: Either side writes to signal disconnect.

---

### 1.4 Call Flow (Signaling Only After Accept)

```
1. Caller creates /calls/{callId} with status: 'ringing'
   → Cloud Function triggers → validates → sends FCM to callee
   → NO signaling yet

2. Callee receives FCM, taps notification, app launches to IncomingCallScreen
   → Callee taps Accept

3. Callee updates /calls/{callId}: status: 'connecting'
   → Caller's Firestore listener sees status change

4. Caller creates RTCPeerConnection, gets offer
   → Caller writes offer to /callSignaling/{callId}/messages/
   → Signaling begins

5. Callee receives offer, creates answer
   → Callee writes answer to /callSignaling
   → ICE candidates flow both ways
   → WebRTC connects
```

---

### 1.5 Firestore Security Rules

**Calls:** Support both `receiverId` (legacy) and `calleeId` (new) during migration.

```javascript
match /calls/{callId} {
  allow read: if request.auth != null &&
    (request.auth.uid == resource.data.callerId ||
     request.auth.uid == resource.data.calleeId ||
     request.auth.uid == resource.data.receiverId);
  
  allow create: if request.auth != null &&
    request.resource.data.callerId != null &&
    (request.resource.data.calleeId != null || request.resource.data.receiverId != null) &&
    request.resource.data.callType != null &&
    request.resource.data.status != null &&
    request.resource.data.createdAt != null &&
    request.auth.uid == request.resource.data.callerId;
  
  allow update, delete: if request.auth != null &&
    (request.auth.uid == resource.data.callerId ||
     request.auth.uid == resource.data.calleeId ||
     request.auth.uid == resource.data.receiverId);
}
```

**Call signaling:** Reference call doc for participant check. Support both `calleeId` and `receiverId`.

```javascript
match /callSignaling/{callId}/messages/{messageId} {
  allow read: if request.auth != null &&
    exists(/databases/$(database)/documents/calls/$(callId)) &&
    (request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.callerId ||
     request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.calleeId ||
     request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.receiverId);
  
  allow create: if request.auth != null &&
    exists(/databases/$(database)/documents/calls/$(callId)) &&
    (request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.callerId ||
     request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.calleeId ||
     request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.receiverId) &&
    request.resource.data.from == request.auth.uid &&
    request.resource.data.to != null &&
    request.resource.data.type != null &&
    request.resource.data.timestamp != null;
  
  allow update, delete: if false; // Messages are immutable
}
```

---

### 1.6 Call Expiration (Ringing Timeout)

**Cloud Function (scheduled):** Every 5 min, query `calls` where `status == 'ringing'` and `createdAt < now - 60s`. Update to `status: 'missed'`, `endedAt: serverTimestamp()`.

**Client timeout:** Caller and callee both run 45s local timeout. On expiry, update status to `missed`. Cloud Function is backup.

---

## 2. Expo & EAS Configuration

### 2.1 Required Permissions (app.json)

**Android (add if missing):**
- `android.permission.RECORD_AUDIO`
- `android.permission.CAMERA`
- `android.permission.MODIFY_AUDIO_SETTINGS`
- `android.permission.BLUETOOTH` / `BLUETOOTH_CONNECT`
- `android.permission.WAKE_LOCK`
- `android.permission.VIBRATE`
- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_MICROPHONE`
- `android.permission.FOREGROUND_SERVICE_CAMERA` (API 34+)
- `android.permission.POST_NOTIFICATIONS`
- `android.permission.USE_FULL_SCREEN_INTENT`
- `android.permission.RECEIVE_BOOT_COMPLETED`

**iOS (infoPlist):**
- `NSMicrophoneUsageDescription`
- `NSCameraUsageDescription`
- `UIBackgroundModes`: `["audio", "remote-notification"]`

---

### 2.2 Config Plugins (app.json / app.config.js)

| Plugin | Purpose |
|--------|---------|
| `@config-plugins/react-native-webrtc` | WebRTC native modules, camera/mic permission strings |
| `expo-notifications` | Push handlers, notification channels, sounds |
| `expo-av` | Microphone permission string for voice recording |
| `expo-build-properties` | minSdkVersion 26, ProGuard |
| `@react-native-firebase/app` | Firebase |
| `@react-native-firebase/messaging` | FCM |

**Recommended plugin config:**

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      ["expo-splash-screen", { "image": "./assets/images/icon.png", "backgroundColor": "#ffffff" }],
      ["expo-av", {
        "microphonePermission": "$(PRODUCT_NAME) would like to use your microphone for voice and video calls."
      }],
      ["expo-build-properties", {
        "android": {
          "minSdkVersion": 26,
          "enableProguardInReleaseBuilds": true
        }
      }],
      ["@config-plugins/react-native-webrtc", {
        "cameraPermission": "$(PRODUCT_NAME) requires camera access for video calls.",
        "microphonePermission": "$(PRODUCT_NAME) requires microphone access for voice and video calls."
      }],
      ["expo-notifications", {
        "icon": "./assets/images/icon.png",
        "color": "#ffffff",
        "sounds": ["./assets/sounds/ringtone.wav"],
        "mode": "production"
      }],
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
      "@react-native-firebase/messaging"
    ],
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": ["audio", "remote-notification"],
        "NSMicrophoneUsageDescription": "$(PRODUCT_NAME) needs microphone access for voice and video calls.",
        "NSCameraUsageDescription": "$(PRODUCT_NAME) needs camera access for video calls."
      }
    }
  }
}
```

---

### 2.3 Deep Linking for Incoming Calls

**Scheme:** `gyw` (from app.json)

**Incoming call deep link:** `gyw://call/incoming/{callId}`

**Expo Router:** Create route `app/(home)/incoming-call/[id].tsx` that:
- Receives `callId` from params
- Loads call from Firestore
- Renders IncomingCallScreen (full-screen modal)
- On Accept: navigates to `/(home)/call/[id]`
- On Decline: updates Firestore, navigates back

**Cold start handling:** In `app/_layout.tsx`, on mount:
- Call `Notifications.getLastNotificationResponseAsync()`
- If `data?.type === 'incoming_call'` and `data?.call_id`, navigate to `/(home)/incoming-call/[callId]`

**FCM payload:** Include `call_id` in data. Cloud Function sets notification `click_action` or `data` so client can route. For expo-notifications / Firebase, use `data: { type: 'incoming_call', call_id: '...' }` and handle in `getLastNotificationResponseAsync` / `addNotificationResponseReceivedListener`.

---

### 2.4 Android: Full-Screen Intent & Notification Channel

**expo-notifications:** Create high-priority channel `incoming_call`:
- `importance: max`
- `sound`: app-bundled ringtone
- `vibrationPattern`: `[0, 500, 200, 500]`
- `lockscreenVisibility`: `public`

**Full-screen intent:** Requires `USE_FULL_SCREEN_INTENT` permission (already in app.json). When FCM arrives with `full_screen_intent: true`, Android can show full-screen activity. Configure via Firebase Cloud Function payload (see Section 4).

---

## 3. Cloud Function: onCallCreated

### 3.1 Trigger

```javascript
exports.onCallCreated = functions.firestore
  .document('calls/{callId}')
  .onCreate(async (snap, context) => {
    const callId = context.params.callId;
    const call = snap.data();
    const { callerId, calleeId, callType } = call;
    const callee = calleeId || call.receiverId; // Support legacy
    if (!callee) return;
    // ...
  });
```

### 3.2 Validation (Before Sending FCM)

1. **Callee online / push token:** Fetch `users/{calleeId}`. Check `fcmToken` exists and is non-empty.
2. **Blocked users:** If you have `users/{uid}/blocked/{blockedId}`, check caller not blocked by callee.
3. **App-level DND:** If `users/{calleeId}.dndEnabled` or `allowCallsFrom === 'nobody'`, do not send. Write `missed_call` event, update caller's call to `rejected` with reason.
4. **System DND:** Cannot check server-side. Rely on FCM priority; Critical Alerts (iOS) require entitlement.

### 3.3 FCM Payload (Android)

```json
{
  "message": {
    "token": "<callee_fcm_token>",
    "data": {
      "type": "incoming_call",
      "call_id": "<callId>",
      "caller_id": "<callerId>",
      "caller_name": "<sanitized>",
      "call_type": "audio|video",
      "avatar_url": "<optional>",
      "ring_timeout_sec": "45",
      "chat_id": "<optional>"
    },
    "android": {
      "priority": "high",
      "notification": {
        "channel_id": "incoming_call",
        "title": "Incoming call",
        "body": "<caller_name>",
        "priority": "max",
        "sound": "ringtone",
        "full_screen_intent": true
      }
    }
  }
}
```

### 3.4 APNs Payload (iOS)

```json
{
  "aps": {
    "alert": { "title": "Incoming call", "body": "<caller_name>" },
    "sound": "ringtone.caf",
    "content-available": 1,
    "mutable-content": 1
  },
  "type": "incoming_call",
  "call_id": "<callId>",
  "caller_id": "<callerId>",
  "caller_name": "<sanitized>",
  "call_type": "audio|video",
  "avatar_url": "<optional>",
  "ring_timeout_sec": "45",
  "chat_id": "<optional>"
}
```

---

## 4. Client Implementation Steps

### Phase 1: Schema & Rules

1. Update `firestore.rules` with rules above (support `calleeId` and `receiverId`).
2. Deploy rules: `firebase deploy --only firestore:rules`
3. Update `callService` / `firestoreNative`: Use `calleeId` for new writes; support `receiverId` for reads during migration.
4. Update `createCall` to write `calleeId`, `callType`, `ringTimeoutSec`, `status: 'ringing'`.

### Phase 2: Cloud Function

1. Create `onCallCreated` in `functions/src/index.ts`.
2. Implement validation (push token, blocked, DND).
3. Send FCM/APNs with payload structure above.
4. Add scheduled function for ringing timeout (optional, or rely on client).
5. Deploy: `firebase deploy --only functions`

### Phase 3: Push Handling & Deep Link

1. Ensure `@react-native-firebase/messaging` is installed and configured.
2. In `app/_layout.tsx` or `NotificationHandler`:
   - On mount: `getLastNotificationResponseAsync()` → if `incoming_call`, navigate to `/(home)/incoming-call/[callId]`
   - `addNotificationResponseReceivedListener` → same navigation
3. Create `app/(home)/incoming-call/[id].tsx`:
   - Load call from Firestore
   - Full-screen IncomingCallScreen UI (avatar, name, Decline/Accept, "Remind me in 5 min")
   - Ringtone + vibration (expo-av, Vibration API)
   - On Accept: Update `/calls/{callId}` status to `connecting`, navigate to `/(home)/call/[id]`
   - On Decline: Update status to `rejected`, write `hangup` to callSignaling, navigate back

### Phase 4: Call Screen & WebRTC

1. Update `app/(home)/call/[id]/index.tsx` (or equivalent):
   - On mount: Subscribe to `/calls/{callId}` and `/callSignaling/{callId}/messages`
   - If `status === 'connecting'` and local user is caller: Create PC, get offer, write to callSignaling
   - If local user is callee: Wait for offer, set remote description, create answer, write to callSignaling
   - Process ICE candidates (queue until remote description set)
   - On `iceconnectionstatechange` → `connected`: Update status to `active`, start duration timer
   - On hangup or status `ended`: Cleanup WebRTC, IncallManager.stop(), navigate back

2. WebRTC service (`lib/webrtcService.ts` or similar):
   - Use `react-native-webrtc`
   - ICE servers: STUN default; TURN via Remote Config (optional)
   - `react-native-incall-manager`: `start()` on connect, `stop()` on end

### Phase 5: Foreground Service (Android)

1. Create `CallForegroundService` (native module or config plugin) that:
   - Starts when call enters `connecting` or `connected`
   - Shows ongoing notification: "Active call • Tap to open"
   - Stops when call ends
2. Add service declaration to AndroidManifest via config plugin.
3. Permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_CAMERA`

### Phase 6: Background Audio (iOS)

1. `UIBackgroundModes`: `["audio", "remote-notification"]` (already in app.json)
2. `react-native-incall-manager` sets `AVAudioSession` for voice/video chat
3. Verify audio continues when app backgrounded during call

---

## 5. WebRTC Signaling Flow (Detail)

### Caller (after callee sets status to `connecting`)

1. Firestore listener on `/calls/{callId}` sees `status === 'connecting'`
2. Create `RTCPeerConnection`, add local tracks (mic, camera if video)
3. `createOffer()` → `setLocalDescription(offer)`
4. Write to `/callSignaling/{callId}/messages`: `{ type: 'offer', from: callerId, to: calleeId, sdp: offer, timestamp }`
5. Subscribe to `callSignaling/{callId}/messages` where `to === callerId`
6. On `answer` event: `setRemoteDescription(answer.sdp)`, process queued ICE candidates
7. On `onicecandidate`: Write `ice-candidate` event to callSignaling

### Callee (after tapping Accept)

1. Update `/calls/{callId}`: `status: 'connecting'`
2. Create `RTCPeerConnection`, add local tracks
3. Subscribe to `callSignaling/{callId}/messages` where `to === calleeId`
4. On `offer` event: `setRemoteDescription(offer.sdp)`, `createAnswer()` → `setLocalDescription(answer)`
5. Write `answer` event to callSignaling
6. On `onicecandidate`: Write `ice-candidate` event
7. Process incoming `ice-candidate` events (queue until remote description set)

### ICE Candidate Ordering

- Process messages by `timestamp`
- Queue ICE candidates until `setRemoteDescription` has been called
- Add candidates in order after remote description is set

---

## 6. EAS Build Requirements

| Component | EAS Build | Native Module |
|-----------|-----------|---------------|
| WebRTC | ✓ | `react-native-webrtc` + `@config-plugins/react-native-webrtc` |
| FCM | ✓ | `@react-native-firebase/messaging` |
| Background audio | ✓ | `react-native-incall-manager` + UIBackgroundModes |
| Foreground service | ✓ | Custom native module or config plugin |
| Full-screen intent | ✓ | expo-notifications + Android channel |

**Expo Go:** Not supported. `react-native-webrtc` and custom notification handling require development build. Document gracefully for Expo Go users (e.g. "Video calls require app update").

---

## 7. Migration from Current Schema

**Current:** `receiverId`, `type`, `callSignaling/{callId}/messages`

**New:** `calleeId`, `callType`, same `callSignaling` path

**Steps:**
1. Deploy new rules (support both `receiverId` and `calleeId`)
2. Update `createCall` to write `calleeId` and `callType`
3. Update readers to prefer `calleeId` with fallback to `receiverId`
4. Cloud Function reads `calleeId || receiverId` for FCM target
5. No data migration needed; new fields apply to new calls only

---

## 8. Performance Budget (Reference)

| Metric | Target |
|--------|--------|
| Call setup time (accept → connected) | < 8s |
| Video decode latency | < 100ms |
| Memory during call | < 150MB |
| Notification tap → call screen | < 3s |

---

*End of Deliverable #1. Proceed to Deliverable #2 (State Machine) when ready.*
