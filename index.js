require('./lib/appInit');

// ── Background FCM handler ────────────────────────────────────────────────────
// Must be registered at module level — before any React component renders —
// so React Native Firebase fires it when the app is in the background or killed.
// This handles INCOMING_CALL / CALL_CANCELLED FCM data messages on both platforms.
require('./lib/services/NotificationService').setupBackgroundHandler();

// ── Android: HeadlessCallTask JS handler ─────────────────────────────────────
// Registered BEFORE expo-router/entry so it is available the moment the
// headless process starts (app may be killed — no React UI is mounted).
//
// Called by HeadlessCallTask.kt when a high-priority INCOMING_CALL or
// CALL_CANCELLED FCM data message arrives while the app is killed/backgrounded.
//
// Rules for headless tasks:
//   • Do NOT call navigation / router — there is no UI context.
//   • Do NOT import heavy UI modules at the top level — bundle size matters here.
//   • Keep execution under 30 s (HeadlessCallTask timeout).
//   • Firestore writes, AsyncStorage updates, and local cache are all safe.
import { AppRegistry } from 'react-native';

AppRegistry.registerHeadlessTask(
  'GywCallHeadlessTask',
  () => async (taskData) => {
    const { type, callId, chatId, text } = taskData ?? {};
    if (!type) return;

    // ── Terminal action updates (small UI accept/decline) ────────────────
    // Must not depend on the RN CallScreen being mounted.
    if (type === 'CALL_ACCEPTED' || type === 'CALL_DECLINED') {
      if (!callId) return;
      const { updateCallStatus } = require('./lib/services/callService');
      const nextStatus = type === 'CALL_ACCEPTED' ? 'accepted' : 'declined';

      console.log(
        `SMALL_UI_HEADLESS terminalAction type=${type} callId=${callId} nextStatus=${nextStatus}`,
      );

      await updateCallStatus(callId, nextStatus);

      console.log(`CALL_DB_UPDATE status=${nextStatus} native=true callId=${callId}`);
      return;
    }

    // ── Chat notification actions (reply / mark read) ────────────────────
    // Must not depend on the RN chat screen being mounted.
    if (type === 'MSG_ACTION_REPLY') {
      if (!chatId || !text) return;
      const replyText = String(text).trim();
      if (!replyText) return;

      console.log(
        `MSG_ACTION_REPLY chatId=${chatId} text="${replyText}"`,
      );

      const { auth } = require('./lib/firebase');
      const { getLastKnownAuthUidAsync } = require('./lib/authLastKnownUid');
      const { getUser, sendMessage, markMessagesAsRead } = require('./lib/services/chatService');

      let uid = auth?.currentUser?.uid;
      if (!uid) uid = await getLastKnownAuthUidAsync();
      if (!uid) {
        console.warn('MSG_ACTION_REPLY missing uid; aborting');
        return;
      }

      const me = await getUser(uid);
      const senderName =
        (me?.firstName ? `${me.firstName} ${me.lastName ?? ''}`.trim() : null) ||
        me?.username ||
        'You';
      const senderAvatar = me?.avatar;

      const messageId = await sendMessage(chatId, uid, senderName, senderAvatar, replyText);
      console.log(`MSG_SEND_SUCCESS messageId=${messageId}`);

      await markMessagesAsRead(chatId, uid);
      console.log(`MSG_NOTIFY_UPDATED chatId=${chatId}`);
      return;
    }

    if (type === 'MSG_ACTION_READ') {
      if (!chatId) return;
      console.log(`MSG_ACTION_READ chatId=${chatId}`);

      const { auth } = require('./lib/firebase');
      const { getLastKnownAuthUidAsync } = require('./lib/authLastKnownUid');
      const { markMessagesAsRead } = require('./lib/services/chatService');

      let uid = auth?.currentUser?.uid;
      if (!uid) uid = await getLastKnownAuthUidAsync();
      if (!uid) {
        console.warn('MSG_ACTION_READ missing uid; aborting');
        return;
      }

      await markMessagesAsRead(chatId, uid);
      console.log(`MSG_READ_SUCCESS chatId=${chatId}`);
      console.log(`MSG_NOTIFY_UPDATED chatId=${chatId}`);
      return;
    }

    if (type === 'INCOMING_CALL' || type === 'call' || type === 'incoming_call') {
      if (!callId) return;
      if (__DEV__) {
        console.log(`INCOMING_TRIGGER source=js_headless_task callId=${callId} ts=${Date.now()}`);
      }
      // Cache the incoming call data so the JS call screen can hydrate
      // without waiting for a Firestore round-trip.
      try {
        const AsyncStorage =
          require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.setItem(
          `pending_call_${callId}`,
          JSON.stringify({ callId, callerId, callerName, callType, ts: Date.now() })
        );
      } catch (_) {
        // Non-fatal — the call screen reads from Firestore as the source of truth.
      }
    }

    if (
      type === 'CALL_CANCELLED' ||
      type === 'call_cancelled' ||
      type === 'call_ended' ||
      type === 'incoming_call_cancelled'
    ) {
      // Remove any cached pending call so a stale entry doesn't confuse the screen.
      try {
        const AsyncStorage =
          require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.removeItem(`pending_call_${callId}`);
      } catch (_) {}
    }

    // IMPORTANT:
    // Do not dispatch incoming/cancel through NotificationService here.
    // GywFirebaseMessagingService already forwards the same FCM to RN Firebase
    // background handler; doing both causes duplicate JS incoming triggers.
  }
);

// ── RNCallKeepBackgroundMessage headless task ─────────────────────────────────
// react-native-callkeep starts this HeadlessJsTaskService on Android when the
// user interacts with a CallKeep notification while the app is killed.
// taskData: { name: 'RNCallKeepBackgroundMessage', callUUID, handle, localizedCallerName }
AppRegistry.registerHeadlessTask(
  'RNCallKeepBackgroundMessage',
  () => async (taskData) => {
    if (!taskData?.callUUID) return;

    if (__DEV__) {
      console.log('[RNCallKeepBackgroundMessage]', taskData);
    }

    // Persist the answer/end action so the JS call screen picks it up
    // when it mounts after this headless task wakes the JS engine.
    try {
      const AsyncStorage =
        require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem(
        'rnCallKeepBgAction',
        JSON.stringify({ ...taskData, ts: Date.now() })
      );
    } catch (_) {}
  }
);

require('expo-router/entry');
