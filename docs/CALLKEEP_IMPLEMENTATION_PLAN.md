# CallKeep Implementation Plan: Native Incoming Call UI (CallKit / ConnectionService)

## Feasibility Summary

**Expo SDK 53 + react-native-callkeep:** Feasible with EAS Build (dev client). Not supported in Expo Go.

| Item | Status |
|------|--------|
| **Expo 53 compatibility** | Use `react-native-callkeep@4.3.16` and `@config-plugins/react-native-callkeep@11.0.0` (per [npm](https://www.npmjs.com/package/@config-plugins/react-native-callkeep)). |
| **Config plugin (CNG)** | Official `@config-plugins/react-native-callkeep` configures native projects at prebuild; no manual `android/` or `ios/` edits required. |
| **iOS (CallKit)** | Full-screen native incoming call UI; works foreground and background. When app is **killed**, iOS often does not run JS until the user taps the notification; after tap, app launches and you can run `getInitialNotification` and then `displayIncomingCall` so the native UI appears. True “wake without tap” when killed requires VoIP Push (Push Kit), which is separate from FCM. |
| **Android (ConnectionService)** | Native incoming call UI; works foreground and background. When app is **killed**, there are known issues: `displayIncomingCall` can fail with “Activity doesn’t exist” because the ConnectionService path expects an activity. Workarounds: use **data-only** FCM (no `notification` block) with **high priority** so `setBackgroundMessageHandler` runs, and ensure CallKeep is set up/triggered from a context that can start an activity (e.g. full-screen intent or starting the app and then showing CallKeep). Some projects use a high-priority FCM notification that launches the app and then show CallKeep from the first screen. |
| **Your stack** | You already use `@react-native-firebase/messaging`, `react-native-webrtc`, EAS Build, and Expo config plugins; adding CallKeep fits the same pattern. |

**Conclusion:** Proceed with CallKeep. Plan for (1) foreground + background working cleanly on both platforms, (2) killed-state on iOS via “tap notification → launch → show CallKeep”, and (3) killed-state on Android via data-only FCM + background handler and, if needed, a fallback high-priority notification that opens the app and then shows CallKeep.

---

## Step-by-Step Implementation Plan

### Phase 1: Dependencies and Expo Config

1. **Install packages**
   - Run: `npx expo install react-native-callkeep@4.3.16 @config-plugins/react-native-callkeep@11.0.0`
   - Do not use a higher config plugin version (e.g. 12.x targets Expo 54).

2. **Add CallKeep config plugin**
   - In `app.json` (or `app.config.ts`), add `@config-plugins/react-native-callkeep` to the `plugins` array.
   - Optionally pass config (e.g. `iosIconName`, `androidExcludeFromRecents`) if the plugin supports it; otherwise default is fine.

3. **iOS: Background modes and permissions**
   - In `app.json` → `expo.ios.infoPlist`:
     - Ensure `UIBackgroundModes` includes `voip` if you will add VoIP push later; for FCM-only keep `audio` and `remote-notification`.
     - Keep microphone/camera usage descriptions.
   - CallKeep config plugin will add CallKit-related entitlements/capabilities during prebuild.

4. **Android: Permissions**
   - Ensure `app.json` → `expo.android.permissions` includes: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_PHONE_CALL`, `USE_FULL_SCREEN_INTENT`, `READ_PHONE_STATE` (if required by the plugin), `CALL_PHONE` (if required), `MANAGE_OWN_CALLS`, `BIND_TELECOM_CONNECTION_SERVICE`. Add only what the plugin or CallKeep docs require; the config plugin may add some automatically.

5. **Prebuild**
   - Run `npx expo prebuild --clean` (or EAS Build) so the plugin generates native code. Do not commit manual edits under `android/` or `ios/` unless the plugin does not cover something you need.

---

### Phase 2: CallKeep Service (Initialization and Events)

6. **Create CallKeep service module**
   - New file, e.g. `lib/services/CallKeepService.ts` (or `src/services/CallKeepService.ts`).
   - Responsibilities:
     - **Setup:** Call `RNCallKeep.setup(options)` once when the app is ready (e.g. after auth, on Android/iOS only). Options: `ios.appName`, `android.alertTitle`, `android.alertDescription`, etc., and `android.channelId` (e.g. `incoming_calls`) so the native UI uses your channel.
     - **Event listeners:** Subscribe to `answerCall`, `endCall`, `didPerformSetMutedCallAction`, etc., and forward to your app (e.g. Zustand store or callbacks) so you can navigate to the call screen, update WebRTC, etc.
     - **Display incoming:** Expose a function `displayIncomingCall(callUUID, handle, name, callType)` that calls `RNCallKeep.displayIncomingCall(...)` with the right params so the native UI shows.
     - **End call:** Expose `endCall(callUUID)` that calls `RNCallKeep.endCall(callUUID)` when the call ends from your side.
   - Call setup from a single place (e.g. root layout or a “phone” provider) when the user is logged in; do not call setup from inside the FCM background handler on Android (activity may not exist).

7. **Integrate with existing call state**
   - When CallKeep fires `answerCall`, navigate to your call screen (e.g. `/(home)/call/[id]`) and continue with WebRTC. When it fires `endCall`, update Firestore and clean up WebRTC. Keep using your existing Firestore call doc and signaling; CallKeep is only the native UI layer.

---

### Phase 3: FCM and Notifications

8. **Notification / FCM service**
   - In a dedicated module (e.g. `lib/services/NotificationService.ts` or extend existing handler):
     - **Foreground:** Keep using `messaging().onMessage()`; when `data.type === 'incoming_call'`, call `CallKeepService.displayIncomingCall(...)` with `data.call_id` as the handle/callUUID and caller name from `data`.
     - **Background (app in background):** Use `messaging().setBackgroundMessageHandler()`. In the handler, parse `data` and call the same `displayIncomingCall` (ensure CallKeep is already set up from a previous app launch so the native layer is ready). Note: On Android, if the app was never brought to foreground after install, setup might not have run; document that the user must open the app at least once.)
     - **Killed – open from notification:** Use `messaging().getInitialNotification()` on cold start. If it’s an incoming call, call `CallKeepService.displayIncomingCall(...)` so the native UI shows as soon as the app is ready.
     - **Killed – Android:** If `setBackgroundMessageHandler` runs when the app is killed, call `displayIncomingCall` from there. If you hit “Activity doesn’t exist”, the fallback is: send a high-priority **notification** message so the user sees a notification and taps it; on open, `getInitialNotification` runs and you then call `displayIncomingCall` so the native full-screen UI appears after launch.

9. **Cloud Function payload**
   - For **Android killed/background:** Prefer **data-only** FCM (no top-level `notification` block) with `android.priority: 'high'` so the client’s `setBackgroundMessageHandler` runs and you can show CallKeep. Include in `data`: `type`, `call_id`, `caller_id`, `caller_name`, `call_type`, etc. (all string values).
   - If you need a fallback for Android when the app is killed (e.g. to show a normal notification if CallKeep doesn’t show), send a second message or a hybrid payload per platform; the plan assumes one payload strategy first (data-only for Android for CallKeep path).
   - For **iOS:** Keep `notification` + `data` and `contentAvailable: 1` so the system can show a notification when the app is killed; on tap, app opens and `getInitialNotification` triggers CallKeep.
   - Provide the exact payload structure (token, data, android, apns) in the “Code Snippets” deliverable.

10. **Android headless task (if required)**
    - If the React Native Firebase background handler is not enough (e.g. OEMs), document or add a headless task entry point (e.g. `index.js` or a registered task) that runs on FCM receive and calls into the same “show incoming call” path. Only add if testing shows the default background handler is not run when the app is killed.

---

### Phase 4: App Entry and Wiring

11. **CallKeep setup on app load**
    - In the root layout or a provider that mounts once when the user is logged in, call `CallKeepService.setup()` (which calls `RNCallKeep.setup`). Do not call setup from the FCM background handler.

12. **FCM listeners**
    - Register `onMessage`, `setBackgroundMessageHandler`, and cold-start `getInitialNotification` in one place (e.g. `appInit.ts` for background handler, and your existing `NotificationHandler` or a service for foreground and cold start). From each path, when you detect `incoming_call` and have `call_id` and caller name, call `CallKeepService.displayIncomingCall(...)`.

13. **Answer / End flow**
    - On `answerCall` from CallKeep, navigate to `/(home)/call/[id]` (or your call route) and start/attach WebRTC. On `endCall`, update Firestore and tear down WebRTC; call `RNCallKeep.endCall(callUUID)` if needed for cleanup.

---

### Phase 5: Build and Test

14. **EAS Build**
    - Run a development build: `eas build --profile development --platform android` (then iOS). Install on device; do not use Expo Go.

15. **Test matrix**
    - **Foreground:** Trigger call → native full-screen incoming UI appears; answer → app goes to call screen; end → call ends.
    - **Background:** Put app in background, trigger call → native incoming UI appears (and/or notification); answer/end as above.
    - **Killed (Android):** Force-close app, trigger call → either native UI appears (if background handler runs and CallKeep works) or at least a high-priority notification; tap → app opens and native CallKeep UI or call screen appears.
    - **Killed (iOS):** Force-close app, trigger call → notification appears; tap → app opens and CallKeep UI or call screen appears.

16. **Troubleshooting doc**
    - **Expo prebuild:** If native code is out of date, run `npx expo prebuild --clean`.
    - **iOS:** CallKit requires proper entitlements (added by config plugin); VoIP push needs a VoIP certificate in Apple Developer and Firebase if you add it later.
    - **Android:** Notification channel `incoming_calls` must exist (create at app startup). Battery optimization should be “Unrestricted” for the app if notifications are delayed or missing.
    - **Android “Activity doesn’t exist”:** Use data-only FCM and background handler; if it still fails when killed, use a high-priority notification that opens the app and then call `displayIncomingCall` from the first screen using `getInitialNotification`.

---

## Deliverables (After Plan Approval)

1. **Exact `app.json` / `app.config.ts` changes** – plugins, permissions, iOS background modes, Android permissions.
2. **`lib/services/CallKeepService.ts`** – setup, `displayIncomingCall`, `endCall`, and event subscriptions (TypeScript).
3. **`lib/services/NotificationService.ts`** (or equivalent) – FCM foreground, background, and cold-start handling that calls CallKeepService (TypeScript).
4. **Android headless task** – only if needed; entry point and how it triggers the same “show incoming call” logic.
5. **Cloud Function** – `onCallCreated` (or equivalent) with the exact FCM payload (data-only for Android CallKeep path, notification+data for iOS).
6. **Troubleshooting section** – Expo prebuild, iOS VoIP/certificates, Android channel and battery, and “Activity doesn’t exist” workaround.

---

## Summary

- **Feasible:** Yes, with Expo 53, `react-native-callkeep@4.3.16`, and `@config-plugins/react-native-callkeep@11.0.0`, using EAS Build.
- **iOS:** Native CallKit UI; background works; killed = show via notification tap then CallKeep (or VoIP later).
- **Android:** Native ConnectionService UI; foreground/background work; killed = data-only FCM + background handler to show CallKeep, with fallback to “notification → open app → show CallKeep” if needed.
- **Next:** Once you approve this plan, the next step is to provide the code snippets and exact payload/channel config as in your deliverables list.
