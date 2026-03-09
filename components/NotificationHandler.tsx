/**
 * Handles incoming call notifications and CallKeep:
 * - Sets up CallKeep when user is logged in; registers answer/end listeners for navigation.
 * - Foreground: onMessage → displayIncomingCall (native UI); answer listener navigates to call.
 * - Cold start: getInitialNotification → displayIncomingCall (or fallback to in-app screen).
 * - Background tap: onNotificationOpenedApp → displayIncomingCall (or fallback).
 * - Background/killed: setBackgroundMessageHandler in appInit.ts triggers displayIncomingCall.
 */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import {
  addAnswerCallListener,
  addEndCallListener,
  displayIncomingCall,
  setupCallKeep,
} from '@/lib/services/CallKeepService';
import { setupNotificationChannel, setupForegroundHandler } from '@/lib/notificationSetup';

function getFirebaseMessaging() {
  if (Platform.OS === 'web') return null;
  try {
    return require('@react-native-firebase/messaging').default;
  } catch {
    return null;
  }
}

type IncomingCallData = Record<string, string | undefined>;

function isIncomingCallData(data: unknown): data is IncomingCallData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as IncomingCallData).type === 'incoming_call' &&
    typeof (data as IncomingCallData).call_id === 'string'
  );
}

export function NotificationHandler() {
  const router = useRouter();
  const { user } = useAuth();
  const hasCheckedColdStart = useRef(false);

  useEffect(() => {
    setupNotificationChannel().catch(() => {});
    setupForegroundHandler();
  }, []);

  const navigateToIncomingCall = (callId: string) => {
    if (!callId) return;
    console.log('[NotificationHandler] Navigating to incoming call screen', {
      path: `/(home)/incoming-call/${callId}`,
      callId,
    });
    router.replace(`/(home)/incoming-call/${callId}` as any);
  };

  const navigateToCall = (callUUID: string) => {
    if (!callUUID) return;
    if (__DEV__) console.log('[NotificationHandler] Answer: navigating to call:', callUUID);
    router.replace(`/(home)/call/${callUUID}?accept=1` as any);
  };

  const navigateToChats = () => {
    if (__DEV__) console.log('[NotificationHandler] End call: navigating to chats');
    router.replace('/(home)/(tabs)/chats' as any);
  };

  /** Show accept/reject UI: navigate first (guaranteed), then try CallKeep native overlay. */
  const showNativeIncomingCall = async (data: IncomingCallData) => {
    const callId = data.call_id!;
    // Navigate FIRST so user always sees Accept/Decline UI immediately.
    // CallKeep native overlay may appear on top if it succeeds.
    navigateToIncomingCall(callId);

    try {
      await displayIncomingCall({
        callUUID: callId,
        handle: data.caller_id ?? '',
        displayName: data.caller_name ?? 'Unknown',
        type: data.call_type === 'video' ? 'video' : 'audio',
      });
      if (__DEV__) console.log('[NotificationHandler] displayIncomingCall ok', callId);
    } catch (err) {
      console.error(
        '[NotificationHandler] displayIncomingCall failed, in-app screen already shown',
        callId,
        err,
      );
    }
  };

  // CallKeep setup and navigation listeners (when user is logged in, iOS/Android only).
  useEffect(() => {
    if (!user?.uid || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;

    setupCallKeep().catch((err) => console.error('[NotificationHandler] setupCallKeep failed', err));

    const removeAnswer = addAnswerCallListener((event) => navigateToCall(event.callUUID));
    const removeEnd = addEndCallListener(() => navigateToChats());

    return () => {
      removeAnswer();
      removeEnd();
    };
  }, [user?.uid]);

  // Foreground: FCM onMessage → show native incoming call UI.
  useEffect(() => {
    if (Platform.OS === 'web' || !user?.uid) return;
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    const unsubscribe = messaging().onMessage((remoteMessage: { data?: Record<string, string> }) => {
      const data = remoteMessage?.data;
      if (__DEV__) console.log('[NotificationHandler] Foreground FCM:', data?.type, data?.call_id);
      if (isIncomingCallData(data)) showNativeIncomingCall(data);
    });

    if (__DEV__) console.log('[NotificationHandler] FCM onMessage registered');
    return () => unsubscribe();
  }, [user?.uid]);

  // Cold start: app opened from FCM notification tap.
  useEffect(() => {
    if (!user?.uid) return;
    if (hasCheckedColdStart.current) return;
    hasCheckedColdStart.current = true;

    const checkColdStart = async () => {
      try {
        const fbMessaging = getFirebaseMessaging();
        if (fbMessaging) {
          const initial = await fbMessaging().getInitialNotification();
          const data = (initial as { data?: Record<string, string> } | null)?.data;
          if (__DEV__)
            console.log('[NotificationHandler] Cold start getInitialNotification:', data ? `${data.type} call_id=${data.call_id}` : 'null');
          if (isIncomingCallData(data)) {
            await showNativeIncomingCall(data);
            return;
          }
        }

        const response = await Notifications.getLastNotificationResponseAsync();
        const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
        if (isIncomingCallData(data)) await showNativeIncomingCall(data);
      } catch (_) {}
    };

    checkColdStart();
  }, [user?.uid]);

  // Background: user taps FCM notification.
  useEffect(() => {
    if (!user?.uid) return;
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    const unsubscribe = messaging().onNotificationOpenedApp((remoteMessage: { data?: Record<string, string> }) => {
      const data = remoteMessage?.data;
      if (__DEV__) console.log('[NotificationHandler] Background tap onNotificationOpenedApp:', data?.type, data?.call_id);
      if (isIncomingCallData(data)) showNativeIncomingCall(data);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  // Expo notification response (e.g. local or other sources).
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (isIncomingCallData(data)) showNativeIncomingCall(data);
    });

    return () => subscription.remove();
  }, []);

  return null;
}
