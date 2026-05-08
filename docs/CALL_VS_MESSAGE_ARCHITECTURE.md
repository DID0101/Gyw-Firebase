# Call vs message: architecture and FCM

This app keeps **two separate systems**: real-time **calls** (signaling + VoIP / full-screen UI) and **async chat** (Firestore history + FCM for alerts). They must not share handlers, CallKit, or “one payload does everything.”

## Call flow (real-time, WhatsApp-call-like)

| Concern | Implementation |
|--------|-----------------|
| **Truth for state** | Firestore `calls/{callId}` (`ringing`, `accepted`, `busy`, timeout, etc.) |
| **Signaling / media** | WebRTC + your signaling path (Firestore snapshots, or another channel) — **not** “infer call from FCM alone” |
| **Wake device / UI** | **Android:** FCM **data-only** + high priority → `GywFcmCallReceiver` posts a notification with **full-screen intent** (channel `gyw_calls`). **iOS:** APNs **VoIP** (PushKit) via `callPushHandler` — separate from the FCM token used for chat. |
| **In-app UI** | Firestore listener in `app/(home)/_layout.tsx` + foreground `onMessage` only for `incoming_call` (mirror / supplement native UI). |
| **Not used for** | Chat text, typing indicators, or `presentMessageLocalNotification`. |

**Principle:** FCM/APNs for calls is a **wake + deep-link hint**. Accept/reject/timeout are driven by **Firestore + app logic**, not by parsing FCM as the source of truth.

## Message flow (async, WhatsApp-message-like)

| Concern | Implementation |
|--------|-----------------|
| **Truth for history** | Firestore `chats/{chatId}/messages/{messageId}` |
| **Push** | Cloud Function `messagePushHandler` on message create → FCM per device. |
| **Android** | **Data-only** + `android.priority: high` — no top-level FCM `notification` key — so `setBackgroundMessageHandler` runs when background/killed and the app posts a **local** notification on channel `gyw_messages` (actions: reply, mark read). |
| **iOS** | FCM **notification + data** so the system can show a banner when killed; background JS skips duplicate local notification when `message.notification` is present (iOS only). |
| **Foreground** | `registerMessageNotificationPresentation` → `onMessage` only if `data.type === message` → local banner if not already in that chat. |
| **Not used for** | Incoming call UI, CallKit, or VoIP token path. |

**Principle:** Chat FCM carries **`data.type: "message"`** and string fields for deep link + preview. Reliability on Android depends on **data-only** so the RN background handler always runs.

## File map (separation)

- **Call push (server):** `functions/src/impl/callPushHandler.ts` — Android FCM data-only; iOS VoIP.
- **Message push (server):** `functions/src/impl/messagePushHandler.ts` — Android data-only; iOS notification+data.
- **Background FCM (client, messages only):** `lib/registerBackgroundMessaging.ts` — ignores `incoming_call`.
- **Foreground chat (client):** `lib/notifications/messageNotifications.ts` — ignores `incoming_call`.
- **Notification tap / cold start:** `app/(home)/_layout.tsx` — `getInitialNotification` / `onNotificationOpenedApp` routes by `pushKind`.
- **Foreground call FCM (client):** same layout, dedicated `onMessage` branch for `incoming_call` only.

## Example FCM payloads

### Chat message — Android (data-only, recommended)

```json
{
  "token": "<fcm_registration_token>",
  "data": {
    "type": "message",
    "chatId": "abc123",
    "messageId": "msg456",
    "senderId": "uid789",
    "senderName": "Alex",
    "text": "Hello",
    "message": "Hello",
    "messageType": "text",
    "timestamp": "1744396800000",
    "senderAvatarUrl": "https://...",
    "mediaUrl": ""
  },
  "android": {
    "priority": "high"
  }
}
```

No `notification` key — the app’s `setBackgroundMessageHandler` schedules a local notification.

### Chat message — iOS (banner when killed + data for app)

Server sends both `notification` and `data` (see `messagePushHandler.ts`). Conceptually:

```json
{
  "token": "<fcm_registration_token>",
  "data": { "type": "message", "chatId": "...", "messageId": "...", "...": "..." },
  "notification": { "title": "Alex", "body": "Hello" },
  "apns": {
    "headers": { "apns-priority": "10" },
    "payload": {
      "aps": {
        "sound": "default",
        "thread-id": "<chatId>",
        "mutable-content": 1,
        "category": "gyw_message"
      }
    }
  }
}
```

### Incoming call — Android (data-only + high priority; native full-screen notifier)

```json
{
  "token": "<fcm_registration_token>",
  "data": {
    "type": "incoming_call",
    "callId": "call_xyz",
    "callerId": "uid_caller",
    "callerName": "Sam",
    "callerAvatar": "https://...",
    "callType": "audio"
  },
  "android": {
    "priority": "high",
    "ttl": 30000
  }
}
```

No top-level `notification` key — otherwise Play Services may not deliver the push to app code when killed, and you cannot attach a **full-screen intent** from FCM alone.

### Incoming call — iOS

VoIP push is sent via APNs with the **VoIP** token (`voipToken` on `userTokens`), not the same FCM flow as messages. See `callPushHandler.ts` and native `GywVoIPPushDelegate`.

## `data.type` contract

| `data.type`       | Handled by |
|-------------------|------------|
| `message`         | `registerBackgroundMessaging`, `messageNotifications`, notification tap router |
| `incoming_call`   | Native call UI + Firestore + dedicated `onMessage` in home layout (not message presenter) |

Constants: `lib/notifications/pushKind.ts`.
