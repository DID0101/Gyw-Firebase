import type { Router } from 'expo-router';
import { Platform } from 'react-native';

import { logCallNavigatingIncoming } from '@/lib/call/callDevLog';
import {
  isCallAcceptedLocally,
  shouldShowIncomingCallAsync,
  toGuardDataFromStore,
} from '@/lib/call/incomingCallGuard';
import { logIncomingUiBlocked, logIncomingUiOpen } from '@/lib/call/incomingUiTrace';
import { useCallSessionStore } from '@/store/callSessionStore';
import {
  callDocToIncomingStore,
  useCallStore,
  type IncomingCallStoreData,
} from '@/store/callStore';
import type { Call } from '@/lib/types/call';

const navigatedIncomingIds = new Set<string>();

function storePayloadFromCall(call: Call): IncomingCallStoreData {
  return callDocToIncomingStore(call);
}

function storePayloadFromIncomingInfo(info: {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
}): IncomingCallStoreData {
  return {
    callId: info.callId,
    callType: info.callType,
    status: 'ringing',
    callerId: info.callerId,
    callerName: info.callerName,
    callerAvatar: info.callerAvatar,
    timestamp: Date.now(),
  };
}

/**
 * Set Zustand incoming payload; on iOS navigate to JS incoming screen.
 * On Android the native IncomingCallActivity is the incoming UI — store only.
 */
export async function openIncomingCallScreen(
  router: Router,
  payload: IncomingCallStoreData,
  source = 'openIncomingCallScreen',
): Promise<void> {
  if (isCallAcceptedLocally(payload.callId)) {
    logIncomingUiBlocked(source, payload.callId, 'accepted_locally', {
      status: payload.status,
    });
    return;
  }
  const guardInput = toGuardDataFromStore(payload);
  if (!(await shouldShowIncomingCallAsync(guardInput))) {
    logIncomingUiBlocked(source, payload.callId, 'guard_rejected', {
      status: payload.status,
    });
    return;
  }
  logIncomingUiOpen(source, payload.callId, { status: payload.status, platform: Platform.OS });

  const { incomingCall } = useCallStore.getState();
  if (incomingCall?.callId === payload.callId && navigatedIncomingIds.has(payload.callId)) {
    return;
  }
  if (!useCallSessionStore.getState().shouldNavigateToIncomingCall(payload.callId)) {
    return;
  }

  useCallStore.getState().setIncomingCall(payload);

  if (Platform.OS === 'android') {
    if (__DEV__) {
      console.log('[CALL] Android: store set, native UI owns incoming — skip JS route', {
        callId: payload.callId,
      });
    }
    return;
  }

  await new Promise((r) => setTimeout(r, 50));

  navigatedIncomingIds.add(payload.callId);
  logCallNavigatingIncoming({
    callId: payload.callId,
    callType: payload.callType,
    callerName: payload.callerName,
  });

  try {
    router.push({
      pathname: '/(home)/call/incoming' as const,
      params: {
        callId: payload.callId,
        callerName: payload.callerName,
        callerAvatar: payload.callerAvatar ?? '',
        callType: payload.callType,
      },
    });
  } catch (_) {
    navigatedIncomingIds.delete(payload.callId);
  }
}

export function clearIncomingNavigationLock(callId?: string): void {
  if (callId) navigatedIncomingIds.delete(callId);
  else navigatedIncomingIds.clear();
}

export { storePayloadFromCall, storePayloadFromIncomingInfo };
