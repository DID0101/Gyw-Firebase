/**
 * Run before RN Firebase loads to silence modular deprecation warnings.
 * Import first in app/_layout.tsx.
 */
if (typeof globalThis !== 'undefined') {
  (globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
}

/**
 * Initialize CallKeep early so it's ready before the first incoming call FCM.
 * Must run at app load (not in React) so native handlers are registered before events fire.
 */
if (typeof require !== 'undefined') {
  try {
    const { Platform } = require('react-native');
    if (Platform?.OS === 'ios' || Platform?.OS === 'android') {
      const { setupCallKeep } = require('@/lib/services/CallKeepService');
      setupCallKeep().catch((err: unknown) =>
        console.error('[appInit] Early setupCallKeep failed', err)
      );
    }
  } catch (_) {}
}

/**
 * Set FCM background message handler. Must be registered at app load (outside React).
 * When the app is backgrounded or killed and an incoming_call FCM arrives, this handler
 * runs in isolation and triggers CallKeep so the native incoming-call UI is shown.
 */
if (typeof require !== 'undefined') {
  try {
    const { Platform } = require('react-native');
    if (Platform?.OS === 'web') {
      // no-op for web
    } else {
      const messaging = require('@react-native-firebase/messaging').default;
      if (messaging && typeof messaging().setBackgroundMessageHandler === 'function') {
        messaging().setBackgroundMessageHandler(async (remoteMessage: { data?: Record<string, string> }) => {
          const data = remoteMessage?.data;
          if (!data || data.type !== 'incoming_call' || typeof data.call_id !== 'string') {
            return;
          }
          const callId = data.call_id;
          const callerName = data.caller_name ?? 'Unknown';

          try {
            const { displayIncomingCall } = require('@/lib/services/CallKeepService');
            await displayIncomingCall({
              callUUID: callId,
              handle: data.caller_id ?? '',
              displayName: callerName,
              type: data.call_type === 'video' ? 'video' : 'audio',
            });
            if (__DEV__) {
              console.log('[appInit] Background FCM: displayIncomingCall ok', callId);
            }
          } catch (err) {
            console.error('[appInit] Background FCM: displayIncomingCall failed', callId, err);
          }

          // Fallback: always show local notification so user sees something when app is killed.
          // CallKeep often fails with "Activity doesn't exist" in headless context.
          try {
            const Notifications = require('expo-notifications');
            await Notifications.scheduleNotificationAsync({
              content: {
                title: 'Incoming Call',
                body: callerName,
                sound: 'ringtone',
                data: { type: 'incoming_call', call_id: callId, ...data },
                channelId: 'incoming_calls',
              },
              trigger: null,
            });
            if (__DEV__) {
              console.log('[appInit] Background FCM: fallback notification scheduled', callId);
            }
          } catch (notifErr) {
            console.error('[appInit] Background FCM: fallback notification failed', callId, notifErr);
          }
        });
      }
    }
  } catch (_) {
    // Firebase or React Native not available (e.g. web)
  }
}
