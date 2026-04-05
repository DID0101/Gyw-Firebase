# Incoming Call Architecture

## FCM Payload (server → Firebase → device)

```json
{
  "message": {
    "token": "<device-fcm-token>",
    "data": {
      "type": "incoming_call",
      "callId": "abc123",
      "callerId": "uid_alice",
      "callerName": "Alice",
      "callType": "audio",
      "hasVideo": "false"
    },
    "android": {
      "priority": "high",
      "direct_boot_ok": true
    },
    "apns": {
      "headers": {
        "apns-push-type": "voip",
        "apns-priority": "10"
      }
    }
  }
}
```

**Critical rules:**
- `data`-only (NO `notification` block) — notification block causes Android to show a tray notification
  before our code runs, bypassing `GywFcmService`
- `priority: high` — ensures delivery to killed apps on Android
- `apns-push-type: voip` — routes to PushKit on iOS (NOT APNs), wakes killed apps instantly

---

## Android Event Timeline

### Killed app

```
1.  Server sends FCM data-only high-priority message
2.  FCM runtime wakes GywFcmService (native, always fires)
3.  GywFcmService.onMessageReceived()
    ├── Writes SharedPreferences (callId, callerName, callType, timestamp)
    └── Calls startForegroundService(GywCallService, ACTION_INCOMING)
4.  GywCallService.onStartCommand()
    ├── startForeground(MICROPHONE type) — mandatory within 5 s
    ├── Acquires WAKE_LOCK (wakes screen on lock screen)
    ├── Shows fullScreenIntent notification (appears on lock screen)
    └── Starts vibration
5.  [On some devices] setBackgroundMessageHandler fires in headless JS
    └── presentIncomingCallInvite(background)
        ├── CallKeep.displayIncomingCall() → system connection service UI (OEM permitting)
        └── Notifee foreground service (MICROPHONE type) → ringtone notification
6.  User sees: either fullScreenIntent notification OR system CallKit-style sheet
7a. User taps notification → MainActivity.onCreate(intent with callId extras)
    ├── GywCallModule.handleCallIntent() → emits GywIncomingCallFromIntent
    └── _layout.tsx listener → router.replace('/(home)/call/[id]')
7b. JS bridge loads → bootstrapAndroidCallSupport()
    └── consumeNativePendingCallIfRecent()
        ├── Reads SharedPreferences (age < 55 s)
        ├── Clears SharedPreferences
        └── navigateToIncomingCallScreen(callId) — direct navigate, NO second system UI
```

### Background app

```
1.  FCM → GywFcmService (native) — same as killed path (steps 2-5)
2.  setBackgroundMessageHandler fires
3.  User taps notification → MainActivity.onNewIntent(intent)
    ├── GywCallModule.handleCallIntent() → emits GywIncomingCallFromIntent
    └── _layout.tsx listener → router.replace (direct, no second call sheet)
4.  If tapped without JS listener ready: AppState 'active' fires
    └── consumeNativePendingCallIfRecent() → navigateToIncomingCallScreen()
```

### Foreground app

```
1.  FCM → messaging().onMessage() (JS foreground handler)
2.  handleFcmCallDataMessage(rec, 'foreground')
3.  navigator ready → navigateToIncomingCallScreen(callId)
    └── User sees in-app ringing screen
```

---

## iOS Event Timeline

### Killed app (PushKit path)

```
1.  Server sends APNs push to VoIP topic (apns-push-type: voip)
2.  iOS wakes app via PushKit — app has ~30 s before termination
3.  GywVoIPPushDelegate.pushRegistry(_:didReceiveIncomingPushWith:)
    ├── Writes UserDefaults (callId, callerName, …)
    └── GywCallKitProvider.provider.reportNewIncomingCall() → native CallKit UI appears
4.  JS bridge loads → react-native-callkeep picks up CXAnswerCallAction / CXEndCallAction
5.  User answers → answerCall listener → navigateToIncomingCallScreen(callId, autoAccept: true)
```

### Background / Foreground app (iOS)

```
1.  PushKit push arrives → same path (always wakes to native CallKit UI)
```

---

## Why `FOREGROUND_SERVICE_TYPE_MICROPHONE` not `PHONE_CALL`

| Type | Requires | We have it? |
|------|----------|------------|
| `phoneCall` | Registered `ConnectionService` with `TelecomManager` + `PhoneAccount` | NO |
| `microphone` | Just `FOREGROUND_SERVICE_MICROPHONE` permission | YES |

On Android 14+ (API 34), using `phoneCall` type without a `ConnectionService` throws
`InvalidForegroundServiceTypeException` which kills the service silently — no notification shown.

---

## Testing Checklist

### Android

- [ ] **Killed**: Force-stop app → receive call → lock screen notification appears < 2 s
- [ ] **Killed → tap notification**: App opens → navigates to call screen (not home screen)
- [ ] **Killed → auto-answer (CallKeep)**: Call screen opens with `accept=1`
- [ ] **Background**: App backgrounded → receive call → notification / system sheet appears
- [ ] **Background → tap notification**: App foregrounds → navigates to call screen
- [ ] **Foreground**: Receive call → in-app call screen appears immediately
- [ ] **Reject from lock screen**: Call status → `rejected` in Firestore
- [ ] **Caller cancels**: GywCallService stops, call screen dismissed
- [ ] **Android 14 device**: No crash on service start (check: `adb logcat | grep -i foreground`)
- [ ] **OEM (TECNO/OPPO/Xiaomi)**: Add app to auto-start whitelist; test killed scenario

### iOS

- [ ] **Killed**: Receive VoIP push → CallKit native UI appears on lock screen
- [ ] **Background**: VoIP push → CallKit sheet appears
- [ ] **Foreground**: VoIP push → in-app call screen (PushKit fires even in foreground)
- [ ] **Accept from CallKit**: Call screen opens with autoAccept
- [ ] **Decline from CallKit**: Firestore status → `rejected`
- [ ] **Apple compliance**: Every VoIP push triggers `reportNewIncomingCall` (check for termination logs)

---

## Key Invariants

1. `GywFcmService` is the PRIMARY call trigger for Android (always native, always fires).
2. JS `setBackgroundMessageHandler` is SECONDARY (may not fire on OEM devices).
3. `consumeNativePendingCallIfRecent` → navigates directly (never shows system call UI).
4. `presentIncomingCallInvite` → only called from JS headless background handler.
5. No `nativeStartIncomingCall` from JS background handler (GywFcmService already did it).
6. `FOREGROUND_SERVICE_TYPE_MICROPHONE` everywhere — no `PHONE_CALL` unless you add a `ConnectionService`.
