/**

 * lib/registerBackgroundMessaging.ts

 *

 * FCM background handler — WAKE ONLY.

 * Does not set Zustand, navigate, or start WebRTC.

 * Firestore is the source of truth; useCallManager syncs once the app runs.

 */



import { NativeModules, Platform } from 'react-native';

import { resolveIncomingCallPayloadNameSync } from '@/lib/contacts/resolveFcmPayload';
import {
  callLatencyMark,
  callLatencyStartFromEpoch,
} from '@/lib/perf/callLatencyTrace';
import {
  shouldShowIncomingCallAsync,
  toGuardDataFromFcm,
} from '@/lib/call/incomingCallGuard';



const INCOMING_TYPES = new Set(['incoming_call', 'call', 'INCOMING_CALL']);

const CANCEL_TYPES = new Set([

  'call_cancelled',

  'incoming_call_cancelled',

  'call_ended',

  'CALL_CANCELLED',

]);



const RING_MAX_AGE_MS = 45_000;



type IncomingCallModuleShape = {

  showIncomingCallScreen: (data: {

    callId: string;

    callType: string;

    callerUid: string;

    callerName: string;

    callerPhotoURL: string;

    timestamp: string;

  }) => void;

  dismissIncomingCallScreen: (callId: string) => void;

};



function getIncomingCallModule(): IncomingCallModuleShape | null {

  const mod = NativeModules.IncomingCallModule as IncomingCallModuleShape | undefined;

  if (!mod?.showIncomingCallScreen) return null;

  return mod;

}



function parseTimestamp(data: Record<string, string | undefined>): number {

  const raw = data.timestamp ?? data.ts ?? '';

  const n = Number(raw);

  return Number.isFinite(n) && n > 0 ? n : Date.now();

}



function isStaleIncoming(timestamp: number): boolean {

  return Date.now() - timestamp > RING_MAX_AGE_MS;

}



async function wakeIncomingCallUi(

  data: Record<string, string | undefined>,

): Promise<void> {

  const callId = data.callId ?? data.call_id ?? '';

  if (!callId) return;



  const timestamp = parseTimestamp(data);
  callLatencyStartFromEpoch(callId, timestamp, 'CALL_START_T0');
  callLatencyMark(callId, 'FCM_RECEIVED', { source: 'js_background' });

  if (!(await shouldShowIncomingCallAsync(toGuardDataFromFcm(callId, timestamp)))) {

    if (__DEV__) {

      console.log('[registerBackgroundMessaging] guard blocked incoming_call', callId);

    }

    return;

  }

  if (isStaleIncoming(timestamp)) {

    if (__DEV__) {

      console.log('[registerBackgroundMessaging] skip stale incoming_call', callId);

    }

    return;

  }



  const callerUid = data.callerUid ?? data.callerId ?? data.caller_id ?? '';

  const callerName = resolveIncomingCallPayloadNameSync(data);

  const callerPhotoURL =

    data.callerPhotoURL ?? data.callerAvatar ?? data.caller_avatar ?? '';

  const callType = data.callType === 'video' ? 'video' : 'audio';



  if (Platform.OS === 'android') {

    const native = getIncomingCallModule();

    if (native) {

      try {

        native.showIncomingCallScreen({

          callId,

          callType,

          callerUid,

          callerName,

          callerPhone: data.callerPhone ?? data.caller_phone ?? '',

          callerPhotoURL,

          timestamp: String(timestamp),

        });

      } catch (e) {

        if (__DEV__) {

          console.warn('[registerBackgroundMessaging] showIncomingCallScreen failed', e);

        }

      }

    }

  }



  if (Platform.OS === 'ios') {

    try {

      const { displayIncomingCall } = require('@/lib/callkeep');

      displayIncomingCall(callId, callerName, callType);

    } catch (_) {

      /* non-fatal */

    }

  }

}



async function dismissIncomingCallUi(

  data: Record<string, string | undefined>,

): Promise<void> {

  const callId = data.callId ?? data.call_id ?? '';

  if (!callId) return;



  if (Platform.OS === 'android') {

    const native = getIncomingCallModule();

    try {

      native?.dismissIncomingCallScreen?.(callId);

    } catch (_) {

      /* non-fatal */

    }

  }



  try {

    const { endCall, endAllCalls } = require('@/lib/callkeep');

    endCall(callId);

    endAllCalls();

  } catch (_) {

    /* non-fatal */

  }

}



/**

 * Register @react-native-firebase/messaging background handler.

 * Call once at module level in index.js (before expo-router/entry).

 */

export function registerBackgroundMessaging(): void {

  if (Platform.OS === 'web') return;



  let messaging: {

    (): {

      setBackgroundMessageHandler: (

        h: (m: { data?: Record<string, string> }) => Promise<void>,

      ) => void;

    };

  };

  try {

    messaging = require('@react-native-firebase/messaging').default;

  } catch {

    if (__DEV__) {

      console.warn('[registerBackgroundMessaging] @react-native-firebase/messaging unavailable');

    }

    return;

  }



  messaging().setBackgroundMessageHandler(async (remoteMessage) => {

    const data = (remoteMessage?.data ?? {}) as Record<string, string | undefined>;

    const type = String(data.type ?? '');



    if (__DEV__) {

      console.log('[registerBackgroundMessaging] background FCM', type, data.callId);

    }



    if (INCOMING_TYPES.has(type) || (!type && data.callId)) {
      if (Platform.OS === 'android') {
        return;
      }
      await wakeIncomingCallUi(data);
      return;
    }



    if (CANCEL_TYPES.has(type)) {

      await dismissIncomingCallUi(data);

      return;

    }



    // Chat messages: native GywMessageNotifier handles display; no JS state here.

    if (type === 'chat_message' || type === 'CHAT_MESSAGE') {

      return;

    }

  });

}


