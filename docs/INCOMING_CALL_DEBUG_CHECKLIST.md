# Incoming Call Push Notification — Diagnostic Checklist

Use this checklist **in order** to isolate where the delivery chain fails. Do not skip steps.

---

## Critical: FCM vs Expo Notifications

Your Cloud Function sends messages via **Firebase Cloud Messaging** (`admin.messaging().send()`). Your app currently handles responses only with **Expo Notifications** (`getLastNotificationResponseAsync`, `addNotificationResponseReceivedListener`).

- **When FCM displays the notification** (background/killed), the **tap** is delivered by the **Firebase Messaging** SDK, not Expo. So `getLastNotificationResponseAsync()` may never see it — you must use **`messaging().getInitialNotification()`** (cold start) and **`messaging().onNotificationOpenedApp()`** (background tap).
- **When app is in foreground**, FCM does not show a system notification; the message is delivered only to **`messaging().onMessage()`**. If you do not listen to `onMessage()` and show in-app UI (or post a local notification), the user gets no ring, no vibration, and no incoming-call screen.

So even if the Cloud Function and token are correct, the client can still show nothing if it only relies on Expo for FCM-sent notifications. After confirming Steps 1–2, add Step 5.1 (Foreground) and 5.2 (Cold start / background) to verify the correct APIs.

---

## Step 1: Cloud Function Execution

**Goal:** Confirm `onCallCreated` runs when a call document is created.

1. **Firebase Console**
   - Go to **Firebase Console → Project → Functions → Logs**.
   - Filter by function name `onCallCreated` (or search for `[onCallCreated]`).
   - Trigger a call (caller starts call to callee). Check whether any log line appears for that call.

2. **Add a first-line log**
   - In `functions/src/index.ts`, at the very start of the `onCreate` callback (before `if (data?.status !== "ringing")`), add:
     - `console.log("🔔 onCallCreated triggered", { callId, status: data?.status });`
   - Deploy: `firebase deploy --only functions:onCallCreated`
   - Trigger a call again. In Functions logs, you should see `🔔 onCallCreated triggered` with the correct `callId`.

3. **If the function does NOT log**
   - **Trigger path:** Trigger must be `firestore.document("calls/{callId}").onCreate`. Confirm the caller creates the document in `calls` (not only in `callSignaling`). Your `createCall` in `callService` writes to `calls`; if the call is created elsewhere (e.g. only in `callSignaling`), the trigger will not run.
   - **Region:** If your Firestore is in another region, ensure the function is deployed to the same region or that cross-region triggers are correct (v1 defaults to `us-central1`).
   - **Errors:** Wrap the whole handler in `try/catch`, log `err` in the catch, and redeploy. Check for unhandled rejections (e.g. missing `await`).

4. **If the function logs but you never see "FCM sent"**
   - Add logs after each validation step:
     - After reading callee doc: `console.log("✅ Callee doc found, token length:", fcmToken?.length ?? 0);`
     - If no token: you already have `[onCallCreated] No FCM token for callee` — confirm that log.
   - Log the payload (without the full token): e.g. `console.log("📤 Sending FCM", { callId, calleeId, hasData: !!payload.data, hasNotification: !!payload.notification });`
   - If you see "FCM sent" in logs but still no notification on device, the failure is after the function (token, payload, or client).

---

## Step 2: FCM Token Validation

**Goal:** Ensure the callee has a valid, current FCM token in Firestore.

1. **Firestore**
   - Open **Firestore Console → `users` → select the callee’s document**.
   - Check that field **`fcmToken`** exists and is a non-empty string (long base64-like string).

2. **Cloud Function**
   - In `onCallCreated`, log: `console.log("🔑 Token length:", fcmToken?.length);`
   - If length is 0 or undefined, the function will exit with "No FCM token for callee". Fix by ensuring the client writes the token (Step 2.3).

3. **Client token registration**
   - Confirm `registerPushToken(userId)` is called after sign-in (e.g. in `app/(home)/_layout.tsx`).
   - Add a one-time log where you get the token: `console.log("📱 FCM token (first 20 chars):", (await messaging().getToken()).slice(0, 20));`
   - Reinstall/clear app data, sign in as callee, and check that this log appears and that `users/{calleeId}.fcmToken` in Firestore is updated.
   - Tokens can expire or be invalidated (e.g. reinstall, token refresh). If the function logs `messaging/invalid-registration-token`, the code that deletes the invalid token is correct; the callee must get a new token on next launch.

4. **Platform**
   - Use the token for the same platform you’re testing (Android vs iOS). Do not mix tokens across platforms.

---

## Step 3: FCM Payload Structure

**Goal:** Ensure the payload matches what Android/iOS expect so the system can show the notification and deliver data.

1. **Android**
   - **Priority:** `android.priority: "high"` and `android.notification.priority: "max"`.
   - **Channel:** `android.notification.channelId` must match the channel created on the client. Your function uses **`incoming_calls`**; your client creates **`incoming_calls`** in `lib/notificationSetup.ts` — they match.
   - **Data for routing:** `data` must include at least `type: "incoming_call"` and `call_id: "<callId>"` (and ideally `caller_name`, etc.) so the client can open the incoming-call screen.
   - **Sound:** `android.notification.sound: "ringtone"` — ensure the app has a sound named `ringtone` (e.g. in `assets/sounds/ringtone.wav` and referenced in `expo-notifications` config). If the name or format is wrong, the channel may fall back to default sound.

2. **iOS**
   - **APNs:** Firebase Console → Project Settings → Cloud Messaging → iOS app: APNs key (or cert) must be uploaded.
   - **Payload:** `apns.payload.aps` should include `alert`, `sound`, and `content-available: 1` for background wake.
   - **Entitlements:** EAS build must include the correct `aps-environment` for the build type (development vs production).

3. **Log payload (without token)**
   - In the function, before `admin.messaging().send()`, log a safe copy of the payload (e.g. omit or truncate `token`) to confirm structure.

---

## Step 4: Client-Side Notification Channel (Android)

**Goal:** Ensure the device has the same channel the FCM payload uses, so the notification can play sound and show as heads-up.

1. **Channel creation**
   - The channel must be created **before** the first incoming-call notification. Your `setupNotificationChannel()` in `lib/notificationSetup.ts` uses ID **`incoming_calls`** — same as the Cloud Function.
   - Confirm `setupNotificationChannel()` is called on app init (e.g. from `NotificationHandler` in `app/_layout.tsx`). Add a log: `console.log("📢 Incoming call channel created");` and verify it runs on launch.

2. **Ringtone**
   - `assets/sounds/ringtone.wav` should exist and be listed in `app.json` under `expo.notifications.sounds` (e.g. `["./assets/sounds/ringtone.wav"]`).
   - Rebuild with EAS so the asset is bundled; verify the file is present in the built app if needed.

---

## Step 5: Foreground vs Background vs Killed — Correct API per State

**Goal:** Use the API that actually receives the FCM message or the notification tap in each app state.

### 5.1 Foreground

- FCM does **not** show a system notification when the app is in foreground. The message is delivered only to **`messaging().onMessage()`**.
- **Check:** Add a listener at app init (e.g. in `NotificationHandler` or a dedicated messaging setup):
  - `messaging().onMessage(async (remoteMessage) => { console.log("📩 Foreground FCM:", remoteMessage?.data); /* then show IncomingCallScreen or local notification */ });`
- Trigger a call with the app in foreground. You must see `📩 Foreground FCM:` with `type: "incoming_call"` and `call_id`. If you never see this, either the message is not reaching the device (token, network, payload) or the listener is not registered.
- If you see the log but no UI: you must **in that listener** either navigate to the incoming-call screen or show a local notification (e.g. via Expo) that triggers your existing UI. Relying only on Expo’s `addNotificationResponseReceivedListener` is not enough for foreground, because no system notification is shown.

### 5.2 Background / Killed — Notification tap

- When the notification is **shown by FCM** (background/killed), the **tap** is delivered by **Firebase Messaging**, not Expo.
- **Cold start (app killed, user taps notification):**
  - Use **`messaging().getInitialNotification()`** in the root layout or early in app init. It returns the message that opened the app. Check `message?.data?.type === 'incoming_call'` and `message?.data?.call_id`, then navigate to `/(home)/incoming-call/[callId]`.
  - **Check:** Add a log: `const msg = await messaging().getInitialNotification(); console.log("📩 Cold start FCM:", msg?.data);` and open the app by tapping the incoming-call notification. You should see the log with `call_id` and `type`.
- **Background (app in background, user taps notification):**
  - Use **`messaging().onNotificationOpenedApp(listener)`**. In the listener, read `message.data` and navigate to the incoming-call screen.
  - **Check:** Add a log in the listener, background the app, trigger a call, tap the notification. You should see the log and then the app should open to the incoming-call screen.

If you only use Expo’s `getLastNotificationResponseAsync()` / `addNotificationResponseReceivedListener`, you may never see taps for FCM-sent notifications. Add the Firebase Messaging handlers above and keep Expo for any notifications you create locally (e.g. from `onMessage`).

---

## Step 6: Deep Link / Route

**Goal:** When the client has the correct `call_id`, it must open the incoming-call screen.

1. **Route**
   - Confirm route `app/(home)/incoming-call/[id].tsx` exists and is registered (e.g. in `app/(home)/_layout.tsx`).

2. **Navigation**
   - In both cold start and background tap handlers, navigate with the **call ID** from the FCM payload: `router.replace("/(home)/incoming-call/" + callId)` (or your equivalent). Use the exact `call_id` from `message.data` (Firebase) or `response.notification.request.content.data` (Expo), not a different key.

3. **Logs**
   - In the cold start and background handlers, log: `console.log("🔗 Navigating to incoming call:", callId);` and confirm this runs when you tap the notification.

---

## Step 7: iOS-Only (if testing on iOS)

1. **APNs in Firebase**
   - Firebase Console → Project Settings → Cloud Messaging → iOS app: APNs authentication key (or certificate) must be uploaded and valid.

2. **Payload**
   - `aps.alert`, `aps.sound`, `aps.content-available: 1`. Sound name (e.g. `ringtone.caf`) must match what’s in the app bundle.

3. **Entitlements**
   - EAS Build: ensure the iOS build has the correct push entitlement (`aps-environment`) for the environment you’re using.

---

## Order of Operations Summary

| Order | What to do |
|-------|------------|
| 1 | Confirm **onCallCreated** runs (logs in Firebase Functions). |
| 2 | Confirm **callee has `fcmToken`** in Firestore and client registers it. |
| 3 | Confirm **payload** has correct `channelId`, `data`, and priorities. |
| 4 | Confirm **Android channel** `incoming_calls` is created on app init and ringtone is bundled. |
| 5 | Add **foreground**: `messaging().onMessage()` → log, then show IncomingCallScreen or local notification. |
| 6 | Add **cold start**: `messaging().getInitialNotification()` → log, then navigate to incoming-call. |
| 7 | Add **background tap**: `messaging().onNotificationOpenedApp()` → log, then navigate. |
| 8 | Confirm **navigation** uses `call_id` from FCM `data` and route `(home)/incoming-call/[id]`. |

Once Step 1 and 2 pass, the most likely cause of “no ring, no UI” in all states is **Step 5**: using only Expo for handling FCM messages and taps instead of Firebase Messaging’s `onMessage`, `getInitialNotification`, and `onNotificationOpenedApp`. Add those three and the navigation step, then re-test foreground, background, and killed.
