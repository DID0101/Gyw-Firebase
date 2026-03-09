/**
 * Notification setup for incoming calls.
 * - Creates Android notification channel with MAX importance
 * - Configures foreground notification handler
 * - Call setupNotificationChannel() and setupNotificationHandlers() from app init
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const INCOMING_CALL_CHANNEL_ID = 'incoming_calls';

/**
 * Create Android notification channel for incoming calls.
 * Must be called before first incoming call notification.
 * Uses IMPORTANCE_MAX for loud sound and heads-up.
 */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(INCOMING_CALL_CHANNEL_ID, {
    name: 'Incoming Calls',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'ringtone',
    vibrationPattern: [0, 250, 250, 250],
    enableVibration: true,
    enableLights: true,
    enableSound: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    showBadge: true,
  });
  if (__DEV__) console.log('[notificationSetup] Android incoming_calls channel created');
}

/**
 * Set foreground handler: show in-app UI instead of system notification for incoming calls.
 */
export function setupForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown>;
      if (data?.type === 'incoming_call') {
        // Don't show system notification when app is in foreground
        // We'll show IncomingCallScreen via the listener
        return {
          shouldShowAlert: true,
          shouldPlaySound: false, // We play local ringtone in IncomingCallScreen
          shouldSetBadge: true,
          shouldShowBanner: true,
          channelId: INCOMING_CALL_CHANNEL_ID,
        };
      }
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
      };
    },
  });
}
