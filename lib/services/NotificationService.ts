/**
 * lib/services/NotificationService.ts
 *
 * Wires up @react-native-firebase/messaging foreground and background handlers
 * and routes FCM call-related messages to the callkeep layer and Zustand store.
 *
 * Message routing
 * ───────────────
 *   INCOMING_CALL / call / incoming_call
 *     → callkeep.displayIncomingCall()        (iOS: system call screen)
 *     → useCallManagerStore.setIncomingCall() (JS state for in-app UI)
 *
 *   CALL_CANCELLED / call_cancelled / call_ended / incoming_call_cancelled
 *     → callkeep.endCall()                    (dismiss native call UI)
 *     → useCallManagerStore.clearCall()       (clear JS state)
 *
 * ⚠️  setupBackgroundHandler() MUST be called at module level (outside React)
 *     from index.js, before expo-router/entry loads.  Calling it inside a
 *     component or useEffect will NOT fire for quit-state messages.
 *
 * @module NotificationService
 */

import { Platform } from 'react-native';
import {
  displayIncomingCall,
  endCall,
} from '@/lib/callkeep';
import {
  useCallManagerStore,
  type IncomingCallInfo,
} from '@/store/callManagerStore';
import {
  tryAcquireIncomingCall,
  releaseIncomingCall,
} from '@/lib/call/incomingCallGuard';

// ── FCM type sets ─────────────────────────────────────────────────────────────

const INCOMING_CALL_TYPES = new Set([
  'call',
  'incoming_call',
  'INCOMING_CALL',
]);

const CANCEL_TYPES = new Set([
  'call_cancelled',
  'incoming_call_cancelled',
  'call_ended',
  'CALL_CANCELLED',
]);

// ── Payload shape ─────────────────────────────────────────────────────────────

interface ParsedCallPayload {
  type:         string;
  callId:       string;
  callerId:     string;
  callerName:   string;
  callerAvatar: string;
  callType:     'audio' | 'video';
}

/**
 * Extract and normalise call fields from an FCM data bundle.
 * Returns null if the data is missing a required callId.
 */
function parseCallPayload(
  data: Record<string, string> | undefined,
): ParsedCallPayload | null {
  if (!data) return null;

  // Support both camelCase and snake_case key variants sent by the server.
  const callId = data.callId ?? data.call_id ?? '';
  if (!callId) return null;

  const rawType = data.type ?? data.call_type ?? '';
  const type =
    String(rawType) ||
    (callId ? 'incoming_call' : '');

  return {
    type:         String(type),
    callId,
    callerId:     data.callerId     ?? data.caller_id     ?? '',
    callerName:   data.callerName   ?? data.caller_name   ?? 'Incoming call',
    callerAvatar: data.callerAvatar ?? data.caller_avatar ?? '',
    callType:     data.callType === 'video' ? 'video' : 'audio',
  };
}

// ── Core dispatcher ───────────────────────────────────────────────────────────

/**
 * Dispatch a parsed FCM RemoteMessage.
 *
 * Safe to call from both foreground (onMessage) and background
 * (setBackgroundMessageHandler) contexts.  Can also be called directly
 * from the RNCallKeepBackgroundMessage headless task.
 *
 * @param message - FCM RemoteMessage (or any object with a `.data` map).
 */
export function handleRemoteMessage(message: {
  messageId?: string;
  data?:      Record<string, string>;
  notification?: { title?: string; body?: string };
}, source: 'js_foreground' | 'js_background' | 'js_headless' = 'js_foreground'): void {
  const data = message.data;
  const rawType = data?.type ?? '';
  if (rawType === 'chat_message' || rawType === 'CHAT_MESSAGE') {
    if (__DEV__) {
      console.log(
        '[NotificationService] chat_message handled by native GywMessageNotifier; JS call path skipped',
        { messageId: message.messageId, chatId: data?.chatId, source },
      );
    }
    return;
  }

  const payload = parseCallPayload(message.data);
  if (!payload) return;

  const { type, callId, callerId, callerName, callerAvatar, callType } = payload;

  // ── Incoming call ──────────────────────────────────────────────────────────
  if (INCOMING_CALL_TYPES.has(type)) {
    const sourceName = source === 'js_foreground' ? 'js_onMessage' : 'js_backgroundMessageHandler';
    if (!tryAcquireIncomingCall(callId, sourceName)) {
      return;
    }
    if (__DEV__) {
      console.log('[NotificationService] INCOMING_CALL', { callId, callerName, type, source });
    }

    const incomingCall: IncomingCallInfo = {
      callId,
      callerId,
      callerName,
      callerAvatar: callerAvatar || undefined,
      callType,
    };

    // Update Zustand so the in-app IncomingCallScreen / useCallManager react.
    useCallManagerStore.getState().setIncomingCall(incomingCall);

    // iOS: CallKit. Android: native Telecom + IncomingCallActivity only — never CallKeep here
    // (duplicate addNewIncomingCall crashes the process).
    if (Platform.OS === 'ios') {
      displayIncomingCall(callId, callerName, callType);
    }
    return;
  }

  // ── Cancellation / hangup ─────────────────────────────────────────────────
  if (CANCEL_TYPES.has(type)) {
    if (__DEV__) {
      console.log('[NotificationService] CALL_CANCELLED', { callId, type });
    }

    const current = useCallManagerStore.getState().incomingCall;
    // Only clear state if this cancel is for the call we're tracking
    // (or if no call is tracked, clear anyway to stay consistent).
    if (!current || current.callId === callId) {
      releaseIncomingCall(callId, 'cancelled');
      useCallManagerStore.getState().clearCall();
      endCall(callId);
    }
    return;
  }

  if (__DEV__) {
    console.log('[NotificationService] non-call FCM type ignored:', type);
  }
}

// ── Foreground handler ────────────────────────────────────────────────────────

let _foregroundUnsub: (() => void) | null = null;

/**
 * Register the foreground FCM message listener.
 *
 * Call this once when the user is authenticated (e.g. inside useCallManager).
 * Returns a cleanup function — pass it to useEffect's return value.
 *
 * @returns Cleanup function that removes the listener.
 */
export function setupForegroundHandler(): () => void {
  if (Platform.OS === 'web') return () => {};

  let messaging: any;
  try {
    messaging = require('@react-native-firebase/messaging').default;
  } catch (_) {
    if (__DEV__) console.warn('[NotificationService] messaging module not available');
    return () => {};
  }

  // Tear down any previous subscription first.
  _foregroundUnsub?.();

  _foregroundUnsub = messaging().onMessage(
    (message: Parameters<typeof handleRemoteMessage>[0]) => {
      if (__DEV__) console.log('[NotificationService] foreground FCM', message.messageId);
      handleRemoteMessage(message, 'js_foreground');
    },
  );

  return () => {
    _foregroundUnsub?.();
    _foregroundUnsub = null;
  };
}

// ── Background / quit-state handler ──────────────────────────────────────────

/**
 * Register the background + quit-state FCM message handler.
 *
 * ⚠️  Must be called at the module level in index.js — before any React
 *     component renders.  This is the only way React Native Firebase will
 *     fire the handler when the app is completely killed.
 *
 * Example (index.js):
 *   import { setupBackgroundHandler } from './lib/services/NotificationService';
 *   setupBackgroundHandler();
 */
export function setupBackgroundHandler(): void {
  if (Platform.OS === 'web') return;

  let messaging: any;
  try {
    messaging = require('@react-native-firebase/messaging').default;
  } catch (_) {
    if (__DEV__) console.warn('[NotificationService] messaging module not available');
    return;
  }

  messaging().setBackgroundMessageHandler(
    async (message: Parameters<typeof handleRemoteMessage>[0]) => {
      if (__DEV__) console.log('[NotificationService] background FCM', message.messageId);
      handleRemoteMessage(message, 'js_background');
    },
  );
}
