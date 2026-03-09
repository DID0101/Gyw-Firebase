# Deliverable #3: Platform-Specific Notification Configuration

## Push-Driven Calling (NO CallKit / ConnectionService)

This document provides the complete notification configuration for incoming calls via FCM/APNs. All calling UI is app-contained; no native telecom integration.

---

## Section 1: iOS Notification Configuration

### A. App Configuration (app.json / app.config.js)

**Required `ios.infoPlist` keys:**

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "GYW needs microphone access for voice and video calls.",
        "NSCameraUsageDescription": "GYW needs camera access for video calls.",
        "UIBackgroundModes": ["audio", "remote-notification"],
        "UILaunchStoryboardName": "SplashScreen"
      }
    }
  }
}
```

**Important:** Do NOT add `voip` to `UIBackgroundModes` — that is for CallKit/ VoIP push. Without CallKit, `voip` is not applicable.

**Critical Alerts (optional, requires Apple entitlement):**
- Add `"critical-alert"` to `UIBackgroundModes` **only after** Apple approves your Critical Alerts entitlement.
- Without entitlement: App will be rejected.

**Expo Config Plugins:**

| Plugin | Purpose |
|--------|---------|
| `expo-notifications` | Push permission, notification channels, handlers |
| `expo-build-properties` | Set `minSdkVersion` (Android), other build flags |
| `@react-native-firebase/app` | Firebase (already in use) |

**expo-notifications plugin config:**

```json
["expo-notifications", {
  "icon": "./assets/images/icon.png",
  "color": "#ffffff",
  "sounds": ["./assets/sounds/ringtone.wav"],
  "mode": "production"
}]
```

**Apple Developer Portal:**

1. **Push Notifications capability:** Enable in the App ID. Required for APNs.
2. **APNs Auth Key:** Create in Certificates, Identifiers & Profiles → Keys. Download `.p8` file. Upload to Expo (EAS credentials) or Firebase Console.
3. **Critical Alerts:** Apply via [Apple Contact Form](https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/). Justification: "Incoming voice/video calls for a communication app. Users must not miss urgent calls." Approval typically 1–2 weeks.

---

### B. Notification Payload Structure (APNs)

**Standard incoming call:**

```json
{
  "aps": {
    "alert": {
      "title": "Incoming Call",
      "body": "John"
    },
    "sound": "ringtone.caf",
    "badge": 1,
    "content-available": 1,
    "mutable-content": 1,
    "category": "INCOMING_CALL"
  },
  "call_id": "abc123",
  "caller_id": "uid_xyz",
  "caller_name": "John",
  "call_type": "video",
  "avatar_url": "https://...",
  "ring_timeout_sec": 45,
  "chat_id": "chat_abc"
}
```

**Critical alert (after entitlement):**

```json
{
  "aps": {
    "alert": {
      "title": "Incoming Call",
      "body": "John"
    },
    "sound": {
      "critical": 1,
      "name": "ringtone.caf",
      "volume": 1.0
    },
    "content-available": 1,
    "mutable-content": 1,
    "interruption-level": "critical"
  },
  "call_id": "abc123",
  "caller_id": "uid_xyz",
  "caller_name": "John",
  "call_type": "video",
  "avatar_url": "https://...",
  "ring_timeout_sec": 45,
  "chat_id": "chat_abc"
}
```

**HTTP/2 headers for APNs:**

- `apns-priority: 10` — immediate delivery
- `apns-push-type: alert` — for user-visible notifications
- `apns-expiration: 0` — no expiration (or set to `createdAt + 60`)

**content-available: 1:** Allows background wake when app is suspended. Does not guarantee wake when app is killed; user may need to tap.

**Critical alert:** Bypasses DND and silent mode. Requires entitlement and `critical: 1` in sound.

**Notification categories:** `INCOMING_CALL` can define Accept/Decline actions. Without CallKit, iOS may not show these in the lock screen. Document as optional.

---

### C. Critical Alerts Permission Flow

**When to prompt:** First time user opens app after install, or first time they enter Settings → Calls. Do not prompt on first launch before other onboarding.

**Permission request flow:**

1. User opens Settings → Calls.
2. Show explainer: "Critical Alerts let you receive calls even when your phone is on silent or Do Not Disturb. Tap to enable."
3. Call `requestCriticalAlertPermission()` (or equivalent from expo-notifications / native module).
4. If granted: `UIBackgroundModes` includes `critical-alert`; app can receive critical alerts.
5. If denied: Use standard notifications. Show: "You'll receive standard notifications. Tap to answer."

**Expo Notifications API:**

- `requestCriticalAlertPermission()` — not in expo-notifications by default. Use `expo-notifications` + `Permissions.askAsync(Permissions.CRITICAL_ALERTS)` if available, or a custom native module.
- Fallback: Check `getPermissionsAsync()` and show a link to Settings if critical alerts are not granted.

**Fallback behavior:** Standard notification with `content-available: 1`. User taps to open. No bypass of DND.

---

### D. Notification Handler Logic (iOS)

**App state vs. notification receipt:**

| App State | Notification Received | Handler |
|-----------|------------------------|---------|
| **Foreground** | `onMessage` / `onNotificationReceived` | Show in-app IncomingCallScreen modal. Do not show system notification. |
| **Background** | `content-available` may wake app | Background handler runs; can navigate to IncomingCallScreen on next foreground. |
| **Killed** | Notification appears on lock screen | User taps → app launches. Use `getLastNotificationResponseAsync()` to get payload. |

**Cold start (app killed):**

1. User taps notification. OS launches app.
2. In `app/_layout.tsx` or root, on mount:
   ```ts
   const response = await Notifications.getLastNotificationResponseAsync();
   if (response?.notification.request.content.data?.type === 'incoming_call') {
     const callId = response.notification.request.content.data.call_id;
     router.replace(`/(home)/incoming-call/${callId}`);
   }
   ```
3. IncomingCallScreen loads call from Firestore. If status is `ended`/`rejected`, show "Call ended" and go back.

**Deduplication:** Use `call_id` as key. If `call_id` is already in `activeCallStore` (e.g. INBOUND_RINGING), ignore duplicate. If notification arrives for same `call_id` within 5s of previous, ignore.

**Pitfall:** `getLastNotificationResponseAsync()` can return `null` if app was launched by icon tap or deep link. Always check `response` before navigating.

---

## Section 2: Android Notification Configuration

### A. App Configuration (app.json + AndroidManifest)

**Required permissions (android.permissions in app.json):**

```json
{
  "expo": {
    "android": {
      "permissions": [
        "android.permission.RECORD_AUDIO",
        "android.permission.CAMERA",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.WAKE_LOCK",
        "android.permission.VIBRATE",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.CAMERA",
        "android.permission.INTERNET",
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.USE_FULL_SCREEN_INTENT",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_MICROPHONE",
        "android.permission.FOREGROUND_SERVICE_CAMERA",
        "android.permission.SYSTEM_ALERT_WINDOW"
      ]
    }
  }
}
```

**AndroidManifest.xml (via config plugin or manual):**

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CAMERA" />

<application ...>
  <service
    android:name=".CallForegroundService"
    android:foregroundServiceType="microphone|camera"
    android:exported="false" />
</application>
```

**Expo Config Plugins:** `expo-notifications`, `expo-build-properties` (minSdkVersion 26), `@config-plugins/react-native-webrtc`.

---

### B. Notification Channel Setup

**Create channel on app launch:**

```ts
// Pseudocode - run in app init
import * as Notifications from 'expo-notifications';

Notifications.setNotificationChannelAsync('incoming_calls', {
  name: 'Incoming Calls',
  importance: Notifications.AndroidImportance.MAX,
  sound: 'ringtone.wav',
  vibrationPattern: [0, 250, 250, 250],
  enableVibration: true,
  enableLights: true,
  enableSound: true,
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  bypassDnd: false,
  showBadge: true,
});
```

**Migration:** If `incoming_calls` channel does not exist, create it. For existing users, channel is created on first app launch after update.

---

### C. Full-Screen Intent Configuration

**Enable full-screen intent:**

- Set `channelId: 'incoming_calls'` (importance MAX).
- In notification payload: `android: { fullScreenIntent: true }` or equivalent.
- With expo-notifications: Use `setFullScreenIntent` via Android-specific options when presenting.

**Limitations:**

- Full-screen intents require **user interaction history** with the app. New installs may not see full-screen until user has interacted.
- Some OEMs (Xiaomi, Huawei, Oppo) restrict full-screen intents. User may need to enable in app settings.
- Android 10+: Full-screen intents are more restricted. Use `USE_FULL_SCREEN_INTENT` permission.

**Fallback:** If full-screen is blocked, show heads-up notification. User taps to open IncomingCallScreen.

**Testing:**

| Android Version | Full-screen intent | Notes |
|-----------------|-------------------|-------|
| 10 | Supported | May show as heads-up first |
| 11 | Supported | Requires permission |
| 12 | Supported | Stricter restrictions |
| 13+ | Supported | POST_NOTIFICATIONS required |

---

### D. Notification Payload Structure (FCM)

**FCM v1 payload:**

```json
{
  "message": {
    "token": "<callee_fcm_token>",
    "data": {
      "type": "incoming_call",
      "call_id": "abc123",
      "caller_id": "uid_xyz",
      "caller_name": "John",
      "call_type": "video",
      "avatar_url": "https://...",
      "ring_timeout_sec": "45",
      "chat_id": "chat_abc"
    },
    "notification": {
      "title": "Incoming Call",
      "body": "John",
      "sound": "ringtone",
      "channel_id": "incoming_calls",
      "priority": "max"
    },
    "android": {
      "priority": "high",
      "notification": {
        "channel_id": "incoming_calls",
        "priority": "max",
        "sound": "ringtone",
        "default_vibrate_timings": false,
        "vibrate_timings": ["0.25s", "0.25s", "0.25s"]
      }
    },
    "apns": {
      "payload": {
        "aps": {
          "alert": { "title": "Incoming Call", "body": "John" },
          "sound": "ringtone.caf",
          "content-available": 1
        }
      },
      "fcm_options": {
        "image": "https://..."
      }
    }
  }
}
```

**data vs notification:**

- **data-only:** App wakes in background. No notification shown unless app creates one. Use for silent wake.
- **notification + data:** System shows notification. User taps → app opens. `data` is available in handler.
- **Recommendation:** Use both. `notification` for display, `data` for routing. Ensures something is shown if handler fails.

**Waking from killed state:** High-priority `data` message can wake the app. For incoming calls, use `priority: high` and `notification` so the user sees a notification and can tap.

---

### E. Foreground Service for Active Calls

**When to start:** On transition to `CONNECTING` (from `INBOUND_RINGING` or `OUTBOUND_RINGING`).

**When to stop:** On transition to `ENDED` or `FAILED`.

**Service notification content:**

- Title: "Active call"
- Text: "00:12" (duration) or "Tap to open"
- Ongoing: true
- Not dismissible
- Tap: Open app to CallScreen

**Service type:** `microphone` for audio calls. `microphone | camera` for video calls.

**Android 12+:** Declare `foregroundServiceType` in manifest. Use `microphone` for audio-only; add `camera` for video.

**Implementation:** Use a custom native module or config plugin. EAS Build can include this. Service class extends `Service`, calls `startForeground(NOTIFICATION_ID, notification)`.

---

### F. Notification Handler Logic (Android)

**App state vs. notification:**

| App State | Notification Received | Handler |
|-----------|------------------------|---------|
| **Foreground** | `onMessage` | Show IncomingCallScreen modal. Do not show system notification. |
| **Background** | Heads-up or full-screen | Full-screen intent may auto-launch IncomingCallScreen. Or user taps notification. |
| **Killed** | Notification appears | User taps → app launches. Use `getLastNotificationResponseAsync()` or equivalent. |

**Full-screen intent auto-launch:** When full-screen intent is allowed, Android may launch the app directly to the activity specified in the intent without user tap. Configure that activity to be IncomingCallScreen with `call_id` from intent extras.

**Deduplication:** Same as iOS. Use `call_id`; ignore if already in INBOUND_RINGING for same call.

---

## Section 3: Firebase Cloud Function (Notification Trigger)

### A. Cloud Function Trigger

**Firestore trigger:**

```ts
// Pseudocode
export const onCallCreated = functions.firestore
  .document('calls/{callId}')
  .onCreate(async (snap, context) => {
    const callId = context.params.callId;
    const data = snap.data();
    if (data.status !== 'ringing') return;
    const calleeId = data.calleeId || data.receiverId; // Backward compat
    const callerId = data.callerId;
    const callType = data.callType || data.type;
    const chatId = data.chatId;
    const ringTimeoutSec = data.ringTimeoutSec || 45;

    // Validation: callee blocked? DND?
    const calleeDoc = await getDb().collection('users').doc(calleeId).get();
    const calleeData = calleeDoc.data();
    const blockedBy = calleeData?.blockedUsers || [];
    if (blockedBy.includes(callerId)) {
      await snap.ref.update({ status: 'rejected', endedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    // Fetch callee's FCM token
    const tokensRef = getDb().collection('users').doc(calleeId).collection('pushTokens');
    const tokensSnap = await tokensRef.get();
    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
    if (tokens.length === 0) return;

    // Sanitize caller name
    const callerDoc = await getDb().collection('users').doc(callerId).get();
    const callerName = callerDoc.data()?.firstName || 'Someone';
    const avatarUrl = callerDoc.data()?.avatarUrl || '';

    // Send FCM
    const payload = buildPayload(callId, callerId, callerName, callType, avatarUrl, ringTimeoutSec, chatId);
    await admin.messaging().sendEachForMulticast({
      tokens,
      data: payload.data,
      notification: payload.notification,
      android: payload.android,
      apns: payload.apns,
    });
  });
```

**Token storage:** `users/{userId}/pushTokens/{tokenId}` with `{ token, platform: 'ios'|'android', updatedAt }`.

---

### B. Payload Construction Logic

```ts
function buildPayload(callId, callerId, callerName, callType, avatarUrl, ringTimeoutSec, chatId) {
  const payload = {
    data: {
      type: 'incoming_call',
      call_id: callId,
      caller_id: callerId,
      caller_name: callerName,
      call_type: callType,
      avatar_url: avatarUrl || '',
      ring_timeout_sec: String(ringTimeoutSec),
      chat_id: chatId || '',
    },
    notification: {
      title: 'Incoming Call',
      body: callerName,
    },
    android: {
      priority: 'high',
      notification: {
        channel_id: 'incoming_calls',
        priority: 'max',
      },
    },
    apns: {
      payload: {
        aps: {
          alert: { title: 'Incoming Call', body: callerName },
          sound: 'ringtone.caf',
          "content-available": 1,
        },
      },
    },
  };
  return payload;
}
```

**Privacy:** If `hidePreview` setting is enabled, use `body: "Incoming call"` and omit `caller_name` from data.

**Localization:** Use `title_loc_key` and `body_loc_key` for multi-language. Example: `"title_loc_key": "incoming_call_title"`.

**TTL:** Set `ttl` in `android` if desired. Default: no expiration.

---

### C. Error Handling & Retry

```ts
// On send failure
try {
  const response = await admin.messaging().sendEachForMulticast({ ... });
  response.responses.forEach((r, i) => {
    if (!r.success && r.error?.code === 'messaging/invalid-registration-token') {
      // Remove stale token
      await tokensRef.doc(tokensSnap.docs[i].id).delete();
    }
  });
} catch (err) {
  if (err.code === 'messaging/invalid-argument') {
    // Log, retry not recommended
  }
  // Optionally: mark call as missed after 45s if no answer
}
```

**Retry:** FCM does not retry automatically. For transient failures, consider a scheduled function that retries unsent calls within 60s.

**Analytics:** Log delivery status (success/failure) without PII. Use for monitoring.

---

## Section 4: Permission Request Flows

### A. iOS Permissions

| Permission | When to Request | Order |
|------------|-----------------|-------|
| Push notifications | After first sign-in | 1 |
| Microphone | Before first audio/video call | 2 |
| Camera | Before first video call | 3 |
| Critical Alerts | In Settings (optional) | 4 |

**Flow:** Request push on sign-in. On first call attempt, show primer: "Allow microphone for calls?" → request. For video, show primer for camera.

**Critical Alerts:** Defer to Settings screen. User opts in.

---

### B. Android Permissions

| Permission | When to Request | Type |
|------------|-----------------|------|
| POST_NOTIFICATIONS | On first launch (Android 13+) | Runtime |
| Microphone | Before first call | Runtime |
| Camera | Before first video call | Runtime |
| Foreground service | Manifest | Declared |

**Order:** Request POST_NOTIFICATIONS early (e.g. after sign-in). Microphone/camera on first call.

**Fallback:** If POST_NOTIFICATIONS denied, show in-app banner: "Enable notifications to receive calls."

---

### C. Permission Denied Recovery

**Detection:** Check `Permissions.getAsync()` or `Permissions.askAsync()` before call. If denied, show banner.

**Settings deep link:** `Linking.openSettings()` or platform-specific (e.g. `Intent` for app settings).

**Degradation:**
- Camera denied: Audio-only mode.
- Microphone denied: Non-dismissible banner "Microphone required" with "Open Settings".
- Critical Alerts denied: Standard notification.
- POST_NOTIFICATIONS denied, Android: Show "Enable notifications" in Settings.

---

## Section 5: Testing Matrix

### A. iOS Test Scenarios

| # | Scenario | Expected | How to Verify |
|---|----------|----------|---------------|
| 1 | App killed → receive call → tap | IncomingCallScreen opens | Kill app, send FCM, tap notification |
| 2 | App backgrounded → receive call | Notification appears, app may wake | Background app, send FCM |
| 3 | App foreground → receive call | In-app modal, no system notification | Foreground app, send FCM |
| 4 | Critical alerts granted → DND | Notification bypasses DND | Enable DND, send FCM |
| 5 | Critical alerts denied | Standard notification | Tap to open |
| 6 | Lock screen → tap | Face ID/Touch ID, then app | Lock device, tap notification |
| 7 | Notification dismissed | Call marked missed in Firestore | Dismiss, check Firestore |
| 8 | Multiple rapid calls | Deduplication by call_id | Send 2 FCM for same call within 5s |

---

### B. Android Test Scenarios

| # | Scenario | Expected | How to Verify |
|---|----------|----------|---------------|
| 1 | App killed → receive call | Full-screen or notification tap | Kill app, send FCM |
| 2 | App backgrounded | Heads-up or full-screen | Background app, send FCM |
| 3 | App foreground | In-app modal | Foreground app, send FCM |
| 4 | Full-screen blocked | Heads-up fallback | Test on OEM that restricts |
| 5 | Foreground service on accept | Persistent "Active call" notification | Accept call, background app |
| 6 | Battery saver | Service may be restricted | Enable battery saver, observe |
| 7 | Android 13+ | POST_NOTIFICATIONS flow | Request permission |
| 8 | Notification dismissed | Call marked missed | Dismiss, check Firestore |

---

## Section 6: EAS Build Configuration

### A. app.json / app.config.js Complete Example

```json
{
  "expo": {
    "name": "GYW",
    "slug": "gyw",
    "version": "1.0.0",
    "scheme": "gyw",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.tropicolx.signal-clone",
      "infoPlist": {
        "NSMicrophoneUsageDescription": "GYW needs microphone access for voice and video calls.",
        "NSCameraUsageDescription": "GYW needs camera access for video calls.",
        "UIBackgroundModes": ["audio", "remote-notification"]
      }
    },
    "android": {
      "package": "com.gyw1.chat",
      "permissions": [
        "android.permission.RECORD_AUDIO",
        "android.permission.CAMERA",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.WAKE_LOCK",
        "android.permission.VIBRATE",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.USE_FULL_SCREEN_INTENT",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_MICROPHONE",
        "android.permission.FOREGROUND_SERVICE_CAMERA",
        "android.permission.SYSTEM_ALERT_WINDOW"
      ],
      "googleServicesFile": "./google-services.json"
    },
    "plugins": [
      "expo-router",
      ["expo-notifications", {
        "icon": "./assets/images/icon.png",
        "color": "#ffffff",
        "sounds": ["./assets/sounds/ringtone.wav"],
        "mode": "production"
      }],
      ["expo-build-properties", {
        "android": {
          "minSdkVersion": 26
        }
      }],
      ["@config-plugins/react-native-webrtc", { ... }],
      "@react-native-firebase/app"
    ]
  }
}
```

---

### B. Credential Setup

**iOS:**
- APNs Auth Key: Create in Apple Developer Portal. Upload to EAS: `eas credentials` → iOS → Push Notifications.
- Or use Firebase Console: Project Settings → Cloud Messaging → APNs Auth Key.

**Android:**
- Firebase: `google-services.json` in project root.
- FCM: Server key or Service Account JSON for Cloud Functions. No client upload for FCM.

**Expo Dashboard:** Configure EAS project. Add credentials via `eas credentials` or Expo dashboard.

---

### C. Build Commands

```bash
# Development build (testing notifications)
eas build --platform android --profile development
eas build --platform ios --profile development

# Production build
eas build --platform android --profile production
eas build --platform ios --profile production
```

**Testing:** Use Firebase Console → Cloud Messaging → "Send test message" with FCM token. Or use Postman/curl to FCM HTTP v1 API.

---

## Section 7: Security & Privacy Checklist

### A. Payload Security

- ❌ Never include SDP, ICE candidates, or auth tokens in payload.
- ❌ Never include unencrypted sensitive user data.
- ✅ Sanitize caller name (max length, no special chars).
- ✅ If privacy mode: use generic "Incoming call" instead of name.
- ✅ Store FCM token in Firestore with user-scoped security rules.

### B. Token Storage

- Store tokens in `users/{userId}/pushTokens/{tokenId}`.
- Restrict writes: `request.auth.uid == userId`.
- Use `expo-secure-store` or encrypted storage for tokens if caching locally.

### C. Rate Limiting

- Cloud Function: Max 5 calls per minute from same caller to same callee.
- Track in Firestore or Cloud Function memory.
- Log and block if exceeded.

### D. Token Management

- On token refresh: Update Firestore. Remove old token.
- On logout: Delete all tokens for user.
- Multi-device: Store multiple tokens per user. Send to all on incoming call.

---

## Migration Notes

### Existing expo-notifications

- Add `expo-notifications` to `plugins` in app.json if not present.
- Configure `sounds` and `channel_id` for incoming calls.
- Add `getLastNotificationResponseAsync()` check in root layout for cold start.
- Add `addNotificationResponseListener()` for background/foreground tap.

### Existing FCM Setup

- No `@react-native-firebase/messaging` in package.json. Add it for FCM token: `firebase.messaging().getToken()`.
- Or use `expo-notifications` `getDevicePushTokenAsync()` — ensure Firebase is initialized before use (EAS Build).
- Store token in Firestore `users/{userId}/pushTokens/{tokenId}` with `{ token, platform, updatedAt }`.

### Payload Changes

- Add `type: "incoming_call"` to data.
- Add `call_id`, `caller_id`, `caller_name`, `call_type`, `avatar_url`, `ring_timeout_sec`, `chat_id`.
- Old app versions: Ignore unknown `type`; no crash. New versions handle `incoming_call`.

### Backward Compatibility

- Support both `receiverId` and `calleeId` in Cloud Function during migration.
- Support both `type` and `callType` in payload.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No notification on iOS | APNs not configured | Check APNs cert/key in Firebase |
| App killed, tap does nothing | `getLastNotificationResponseAsync` not called | Call in root layout, before navigation |
| Full-screen intent not showing | OEM restriction | User enables in app settings |
| Token invalid | Stale token | Refresh token, remove old from Firestore |
| No notification in foreground | Handler shows in-app UI | Expected; notification suppressed |
| Firebase not initialized (Android) | `getDevicePushTokenAsync` fails | Ensure Firebase init before Notifications |

---

## Expo Go vs EAS Development Build

| Feature | Expo Go | EAS Development Build |
|---------|---------|------------------------|
| Push notifications | Limited (Expo push) | Full FCM/APNs |
| Background handlers | No | Yes |
| Foreground service | No | Yes |
| Full-screen intent | No | Yes |
| Custom notification sounds | No | Yes |

**For calling:** Use EAS Development Build. Expo Go does not support the required notification flow.

---

*End of Deliverable #3. Proceed to Deliverable #4 (Firestore Schema & Security Rules Deep Dive) when ready.*
