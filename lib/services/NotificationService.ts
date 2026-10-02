/**
 * lib/services/NotificationService.ts
 *
 * Foreground FCM — route incoming calls to native IncomingCallActivity;
 * chat messages stay on native GywMessageNotifier (no JS banner here).
 */

import { NativeModules, Platform } from 'react-native';

import { resolveIncomingCallPayloadNameSync } from '@/lib/contacts/resolveFcmPayload';
import { ensureContactsHydratedForNotifications } from '@/store/contactsStore';
import {
  shouldShowIncomingCall,
  shouldShowIncomingCallAsync,
  toGuardDataFromFcm,
} from '@/lib/call/incomingCallGuard';
import { displayIncomingCall, endCall, endAllCalls } from '@/lib/callkeep';
import { useCallManagerStore } from '@/store/callManagerStore';

const INCOMING_CALL_TYPES = new Set(['call', 'incoming_call', 'INCOMING_CALL']);

const CANCEL_TYPES = new Set([
  'call_cancelled',
  'incoming_call_cancelled',
  'call_ended',
  'CALL_CANCELLED',
]);

const RING_MAX_AGE_MS = 45_000;

interface ParsedCallPayload {
  type: string;
  callId: string;
  callerId: string;
  callerName: string;
  callerPhone: string;
  callerAvatar: string;
  callType: 'audio' | 'video';
  timestamp: number;
}

function parseCallPayload(
  data: Record<string, string> | undefined,
): ParsedCallPayload | null {
  if (!data) return null;

  const callId = data.callId ?? data.call_id ?? '';
  if (!callId) return null;

  const rawType = data.type ?? data.call_type ?? '';
  const type = String(rawType) || (callId ? 'incoming_call' : '');
  const tsRaw = data.timestamp ?? data.ts ?? '';
  const tsNum = Number(tsRaw);
  const timestamp = Number.isFinite(tsNum) && tsNum > 0 ? tsNum : Date.now();

  return {
    type: String(type),
    callId,
    callerId: data.callerUid ?? data.callerId ?? data.caller_id ?? '',
    callerName: data.callerName ?? data.caller_name ?? 'Incoming call',
    callerPhone: data.callerPhone ?? data.caller_phone ?? '',
    callerAvatar:
      data.callerPhotoURL ?? data.callerAvatar ?? data.caller_avatar ?? '',
    callType: data.callType === 'video' ? 'video' : 'audio',
    timestamp,
  };
}

function getIncomingCallModule():
  | {
      showIncomingCallScreen?: (d: Record<string, string>) => void;
      dismissIncomingCallScreen?: (id: string) => void;
    }
  | undefined {
  return NativeModules.IncomingCallModule as
    | {
        showIncomingCallScreen?: (d: Record<string, string>) => void;
        dismissIncomingCallScreen?: (id: string) => void;
      }
    | undefined;
}

async function showNativeIncomingUi(payload: ParsedCallPayload): Promise<void> {
  const { callId, callType, callerId, callerAvatar, timestamp } = payload;
  const callerName = await resolveIncomingCallPayloadName({
    callerName: payload.callerName,
    callerPhone: payload.callerPhone,
  });

  if (Platform.OS === 'android') {
    const mod = getIncomingCallModule();
    try {
      mod?.showIncomingCallScreen?.({
        callId,
        callType,
        callerUid: callerId,
        callerName,
        callerPhotoURL: callerAvatar,
        timestamp: String(timestamp),
      });
      if (__DEV__) {
        console.log(
          '[NotificationService] launched IncomingCallActivity for foreground call',
          callId,
        );
      }
    } catch (e) {
      if (__DEV__) {
        console.warn('[NotificationService] showIncomingCallScreen failed', e);
      }
    }
    return;
  }

  if (Platform.OS === 'ios') {
    displayIncomingCall(callId, callerName, callType);
  }
}

function dismissNativeIncomingUi(callId: string): void {
  if (Platform.OS === 'android') {
    const mod = getIncomingCallModule();
    try {
      mod?.dismissIncomingCallScreen?.(callId);
    } catch (_) {
      /* non-fatal */
    }
  }
  endCall(callId);
  endAllCalls();
}

/**
 * Foreground FCM dispatcher — native full-screen call UI + Zustand mirror.
 */
export async function handleRemoteMessage(
  message: {
    messageId?: string;
    data?: Record<string, string>;
    notification?: { title?: string; body?: string };
  },
  source: 'js_foreground' | 'js_background' | 'js_headless' = 'js_foreground',
): Promise<void> {
  const data = message.data;
  const rawType = data?.type ?? '';

  if (rawType === 'chat_message' || rawType === 'CHAT_MESSAGE') {
    if (__DEV__) {
      console.log('[NotificationService] chat_message — native notifier only', {
        messageId: message.messageId,
        source,
      });
    }
    return;
  }

  const payload = parseCallPayload(message.data);
  if (!payload) return;

  const { type, callId } = payload;

  if (INCOMING_CALL_TYPES.has(type)) {
    try {
      const { auth } = require('@/lib/firebase');
      const selfUid = auth?.currentUser?.uid;
      if (selfUid && payload.callerId && selfUid === payload.callerId) {
        if (__DEV__) {
          console.log('[NotificationService] Ignoring self-caller INCOMING_CALL', {
            callId,
            source,
          });
        }
        return;
      }
    } catch (_) {
      /* ignore */
    }

    if (Date.now() - payload.timestamp > RING_MAX_AGE_MS) {
      if (__DEV__) {
        console.log('[NotificationService] ignoring stale call', callId);
      }
      return;
    }

    if (!shouldShowIncomingCall(toGuardDataFromFcm(callId, payload.timestamp))) {
      if (__DEV__) {
        console.log('[NotificationService] guard blocked foreground call', callId);
      }
      return;
    }

    const resolvedCallerName = resolveIncomingCallPayloadNameSync({
      callerName: payload.callerName,
      callerPhone: payload.callerPhone,
    });

    useCallManagerStore.getState().setIncomingCall({
      callId,
      callerId: payload.callerId,
      callerName: resolvedCallerName,
      callerAvatar: payload.callerAvatar || undefined,
      callType: payload.callType,
    });
    useCallManagerStore.getState().setActiveCallId(callId);
    void ensureContactsHydratedForNotifications();

    if (Platform.OS === 'android') {
      if (__DEV__) {
        console.log('[NotificationService] Android incoming — native FCM owns UI, store mirrored', {
          callId,
          source,
        });
      }
      return;
    }

    if (!(await shouldShowIncomingCallAsync(toGuardDataFromFcm(callId, payload.timestamp)))) {
      if (__DEV__) {
        console.log('[NotificationService] guard blocked foreground call', callId);
      }
      return;
    }

    if (__DEV__) {
      console.log('[NotificationService] wake incoming UI', { callId, source });
    }

    await showNativeIncomingUi({ ...payload, callerName: resolvedCallerName });
    return;
  }

  if (CANCEL_TYPES.has(type)) {
    if (__DEV__) {
      console.log('[NotificationService] dismiss incoming UI', { callId, type, source });
    }
    dismissNativeIncomingUi(callId);
    useCallManagerStore.getState().clearCall();
    useCallManagerStore.getState().setActiveCallId(null);
  }
}

let _foregroundUnsub: (() => void) | null = null;

export function setupForegroundHandler(): () => void {
  if (Platform.OS === 'web') return () => {};

  let messaging: any;
  try {
    messaging = require('@react-native-firebase/messaging').default;
  } catch (_) {
    if (__DEV__) console.warn('[NotificationService] messaging module not available');
    return () => {};
  }

  _foregroundUnsub?.();

  _foregroundUnsub = messaging().onMessage(
    (message: Parameters<typeof handleRemoteMessage>[0]) => {
      if (__DEV__) console.log('[NotificationService] foreground FCM', message.messageId);
      void handleRemoteMessage(message, 'js_foreground');
    },
  );

  return () => {
    _foregroundUnsub?.();
    _foregroundUnsub = null;
  };
}

/** @deprecated Use registerBackgroundMessaging() in index.js */
export function setupBackgroundHandler(): void {
  if (__DEV__) {
    console.log(
      '[NotificationService] setupBackgroundHandler skipped — use registerBackgroundMessaging()',
    );
  }
}
