# Message notifications — production FCM + local (WhatsApp / Signal style)

End-to-end design for **chat message** pushes: **Android = data-only + local**, **iOS = FCM `notification` + `data` (system banner in background/killed) + same `data` for taps**, **local** via `expo-notifications` where JS runs, **per-message identity**, grouping, actions, **multi-device tokens**, and **deep links**.

## Payload strategy (why not “data-only everywhere”?)

| Platform | FCM shape | Why |
|----------|-----------|-----|
| **Android** | **Data-only** + `android.priority: "high"` | OEMs often throttle or collapse **notification** messages when the app is killed. Data + high priority wakes **Headless JS** so `setBackgroundMessageHandler` can post an **expo-notifications** local notification with your channel, avatar, grouping, and dedupe. |
| **iOS** | **`notification` { title, body, imageUrl? }` + `data` { … }** + APNs `sound`, `threadId`, `mutable-content`, `category` | When the app is **swiped away or not running**, **silent / background-only** pushes are **not** guaranteed to run your JS. A visible **`notification`** payload lets **APNs** show the banner like WhatsApp/Signal. The same **`data`** map is still delivered for `getInitialNotification` / `onNotificationOpenedApp` / in-app routing. |
| **Foreground (both)** | Either shape | `messaging().onMessage` → local notification (deduped by `messageId`); iOS often does not show a system banner while the app is open. |

## Architecture

| App state | Android | iOS |
|-----------|---------|-----|
| **Background / killed** | FCM **data-only** → `setBackgroundMessageHandler` → **local** notification | FCM **`notification` + `data`** → **system** notification; background handler **skips** extra local when `message.notification` is present |
| **Foreground** | `onMessage` → **local** (skip if already in that chat) | `onMessage` → **local** (same) |
| **Tap / actions** | FCM open handlers + `expo-notifications` response | Same |
| **Cold start** | FCM `getInitialNotification` + last `expo-notifications` response | Same |

### Reliability notes

- **Android:** Data + high priority + headless handler; battery savers can still delay JS — users may need to whitelist the app.
- **iOS:** Rich attachment polish beyond `notification.imageUrl` may still need a **Notification Service Extension** (`docs/ios/NOTIFICATION_SERVICE_EXTENSION.md`).

### Debug logging (delivery vs display)

- In **development**, `lib/pushDebugLog.ts` logs `[push:…]` for background handler entry, local present, dedupe skips, and token registration prefix.
- In **release** builds, set `globalThis.__GYW_FCM_DEBUG__ = true` once (e.g. from a hidden dev gesture) to enable the same logs on device.

### Idempotency

- Client: `tryConsumeMessageNotifyOnce(messageId)` in `lib/notifications/messageIdempotency.ts` prevents duplicate local banners when FCM retries or multiple handlers run.
- Server: Firestore `onCreate` is naturally once per message document.

## Data contract (FCM `data` — all strings)

| Key | Description |
|-----|--------------|
| `type` | Always `"message"` for chat pushes |
| `chatId` | Firestore chat id |
| `messageId` | Firestore message doc id |
| `senderId` | Sender uid |
| `senderName` | Display name |
| `text` | Preview line (same as `message`) |
| `message` | Preview (duplicate for tooling) |
| `messageType` | `text` \| `image` \| `video` \| `audio` \| `file` |
| `timestamp` | Epoch **milliseconds** as string |
| `senderAvatarUrl` | HTTPS URL or empty |
| `mediaUrl` | Optional HTTPS image/video/audio URL for attachment preview |

## Backend

- **Trigger:** `messagePush` on `chats/{chatId}/messages/{messageId}` `onCreate` (`functions/src/index.ts`).
- **Handler:** `functions/src/impl/messagePushHandler.ts`
  - Resolves **all FCM targets**: legacy `userTokens/{uid}.fcmToken` plus **`userTokens/{uid}/devices/*`** (multi-device).
  - Sends **data-only** to Android and iOS (no top-level FCM `notification` object).
  - iOS APNs: `content-available`, `threadId`, `category: gyw_message`, headers `apns-priority: 10`, `apns-push-type: background`.

Deploy:

```bash
cd functions && npm run build && firebase deploy --only functions:messagePush
```

## Client modules

| File | Role |
|------|------|
| `index.js` | `registerBackgroundMessaging()` **before** `expo-router/entry` |
| `lib/registerBackgroundMessaging.ts` | FCM background handler → `presentMessageLocalNotification` |
| `lib/notifications/constants.ts` | Channel ids, category id, action ids |
| `lib/notifications/messagePayload.ts` | `parseMessagePushData` |
| `lib/notifications/messageNotificationPresenter.ts` | Local notification + Android group summary + iOS image attachment |
| `lib/notifications/messageIdempotency.ts` | Dedupe by `messageId` |
| `lib/notifications/notificationCategories.ts` | Reply + Mark read (`setNotificationCategoryAsync`) |
| `lib/notifications/notificationActionHandler.ts` | Firestore **mark read** + **send reply** + default tap |
| `lib/notifications/messageNotifications.ts` | Foreground FCM + notification response wiring |
| `lib/fcmTokenService.ts` | Permissions, token, refresh, **`devices/{installationId}`** |
| `lib/pushInstallationId.ts` | Stable per-install id for device rows |
| `app/(home)/_layout.tsx` | Categories + channel bootstrap; FCM open handlers; `registerMessageNotificationPresentation` |

### Android channels

- **`gyw_messages`** — `MAX` importance, sound, vibration (`ensureMessageAndroidChannel` + background eager create).
- **`gyw_calls`** — reserved for future in-app call banners (`ensureCallAndroidChannel`).

### Grouping (Android)

- Each message: `tag` / identifier = `msg_<messageId>`.
- `groupId` = `chat_<chatId>`.
- **Summary** notification `chat_summary_<chatId>` with `groupSummary: true`.

### Threading (iOS)

- APNs `threadId` in the push helps Notification Center grouping.
- Local notifications can attach an **image** when `messageType === image'` and `mediaUrl` is HTTPS.

### Badge

- Incremented on each successfully shown local notification (`badgeService.ts`).
- Cleared / adjusted when opening a chat (`dismissChatNotifications`) and when app becomes active (`clearBadge` in `_layout.tsx`). For **exact unread parity** with Firestore, extend with a small sync that sums `unreadCount` (optional product work).

## Firestore rules

`userTokens/{userId}/devices/{deviceId}` — owner-only; fields: `fcmToken`, `platform`, `updatedAt`, `installationId`.

## Example FCM payloads (HTTP v1 style)

All **`data`** values must be **strings**.

**Android — data-only (what `messagePush` sends):**

```json
{
  "token": "<fcm_token>",
  "data": {
    "type": "message",
    "chatId": "abc123",
    "messageId": "msg456",
    "senderId": "user789",
    "senderName": "Ada",
    "text": "Hello",
    "message": "Hello",
    "messageType": "text",
    "timestamp": "1744454400000",
    "senderAvatarUrl": "https://example.com/a.jpg",
    "mediaUrl": ""
  },
  "android": { "priority": "HIGH" }
}
```

**iOS — `notification` + `data` (what `messagePush` sends):**

```json
{
  "token": "<fcm_token>",
  "data": { "type": "message", "chatId": "abc123", "messageId": "msg456", "senderId": "user789", "senderName": "Ada", "text": "Hello", "message": "Hello", "messageType": "text", "timestamp": "1744454400000", "senderAvatarUrl": "https://example.com/a.jpg", "mediaUrl": "" },
  "notification": { "title": "Ada", "body": "Hello", "imageUrl": "https://example.com/a.jpg" },
  "apns": {
    "headers": { "apns-priority": "10" },
    "payload": { "aps": { "sound": "default", "threadId": "abc123", "mutable-content": 1, "category": "gyw_message" } }
  }
}
```

## Native setup checklist

1. **Firebase** — iOS APNs key uploaded; Android `google-services.json`; FCM enabled.
2. **`app.json`** — `expo-notifications` plugin; `POST_NOTIFICATIONS`; iOS `UIBackgroundModes` includes `remote-notification`.
3. **`index.js`** — background handler registered first.
4. **AndroidManifest** — `com.google.firebase.messaging.default_notification_channel_id` = `gyw_messages` with `tools:replace="android:value"` if Gradle merge conflicts.
5. **Rebuild** after native config: `npx expo prebuild` (if applicable) then `npx expo run:android` / `run:ios`.

## Limitations vs full native WhatsApp

- **Android MessagingStyle** (inline conversation layout) is not exposed by Expo; needs a small custom native module if you require pixel-perfect MessagingStyle.
- **iOS rich media from cold push** without JS often needs a **Notification Service Extension** to download attachments before display — see `docs/ios/NOTIFICATION_SERVICE_EXTENSION.md`.

## Troubleshooting

- **No banner when killed (iOS):** Confirm APNs key in Firebase, Push Notifications capability, and that the server sends **`notification` + `data`** (not data-only). Rebuild after `app.json` / entitlements changes.
- **No Android banner:** Channel id, POST_NOTIFICATIONS, battery optimization, `registerBackgroundMessaging` import order.
- **Reply / Mark read does nothing:** User must be signed in (native Firebase Auth); actions use `opensAppToForeground: true` so JS runs after cold start.
