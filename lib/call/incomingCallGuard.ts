import { Platform } from 'react-native';

import { isNativeIncomingCallVisible } from '@/lib/call/nativeIncomingCall';
import { useCallStore, type IncomingCallStoreData } from '@/store/callStore';

/** Input for duplicate/stale incoming filtering (status + age + dismiss memory). */
export type IncomingCallGuardData = {
  callId: string;
  status: string;
  /** Epoch ms when the call was created / push was sent. */
  createdAt: number;
};

const STALE_MS = 45_000;
const ACQUIRE_WINDOW_MS = 60_000;

let lastDismissedCallId: string | null = null;
/** Callee pressed accept — block all incoming UI for this callId until terminal cleanup. */
const acceptedCallIds = new Set<string>();
const acquireEntries = new Map<string, number>();

function pruneAcquire(now: number) {
  for (const [callId, ts] of acquireEntries) {
    if (now - ts > ACQUIRE_WINDOW_MS) acquireEntries.delete(callId);
  }
}

export function toGuardDataFromStore(data: IncomingCallStoreData): IncomingCallGuardData {
  return {
    callId: data.callId,
    status: data.status,
    createdAt: data.timestamp,
  };
}

export function toGuardDataFromFcm(
  callId: string,
  createdAtMs: number,
): IncomingCallGuardData {
  return {
    callId,
    status: 'ringing',
    createdAt: createdAtMs,
  };
}

export function isCallAcceptedLocally(callId: string): boolean {
  return acceptedCallIds.has(callId);
}

/** Callee accepted — never reopen incoming UI / ring for this callId. */
export function markCallAccepted(callId: string, reason = 'unknown'): void {
  if (!callId) return;
  acceptedCallIds.add(callId);
  acquireEntries.delete(callId);
  if (__DEV__) {
    console.log('INCOMING_UI_BLOCKED', { callId, reason, accepted: true });
  }
}

export function clearCallAccepted(callId: string): void {
  acceptedCallIds.delete(callId);
}

/**
 * Filter duplicate/stale incoming events before UI or native notification.
 */
export function shouldShowIncomingCall(callData: IncomingCallGuardData): boolean {
  if (acceptedCallIds.has(callData.callId)) {
    if (__DEV__) {
      console.log('[CALL] incoming guard: skip accepted', { callId: callData.callId });
    }
    return false;
  }

  if (callData.status !== 'ringing') {
    if (__DEV__) {
      console.log('[CALL] incoming guard: skip non-ringing', {
        callId: callData.callId,
        status: callData.status,
      });
    }
    return false;
  }

  if (Date.now() - callData.createdAt > STALE_MS) {
    if (__DEV__) {
      console.log('[CALL] incoming guard: skip stale', {
        callId: callData.callId,
        ageMs: Date.now() - callData.createdAt,
      });
    }
    return false;
  }

  if (callData.callId === lastDismissedCallId) {
    if (__DEV__) {
      console.log('[CALL] incoming guard: skip dismissed', { callId: callData.callId });
    }
    return false;
  }

  const active = useCallStore.getState().activeCall;
  if (active && active.id !== callData.callId) {
    if (__DEV__) {
      console.log('[CALL] incoming guard: skip other active call', {
        callId: callData.callId,
        activeCallId: active.id,
      });
    }
    return false;
  }

  return true;
}

/**
 * Async guard — includes Android native IncomingCallActivity visibility.
 * Use before opening the JS incoming route or duplicating native UI.
 */
export async function shouldShowIncomingCallAsync(
  callData: IncomingCallGuardData,
): Promise<boolean> {
  if (!shouldShowIncomingCall(callData)) return false;

  if (Platform.OS === 'android') {
    const nativeVisible = await isNativeIncomingCallVisible();
    if (nativeVisible) {
      if (__DEV__) {
        console.log('[CALL] incoming guard: skip — native IncomingCallActivity visible', {
          callId: callData.callId,
        });
      }
      return false;
    }
  }

  return true;
}

/** Remember a dismissed call so it is not re-shown from late FCM/Firestore. */
export function markCallDismissed(callId: string): void {
  lastDismissedCallId = callId;
  acceptedCallIds.delete(callId);
  acquireEntries.delete(callId);
  if (__DEV__) {
    console.log('[CALL] incoming guard: marked dismissed', { callId });
  }
}

/** Short-window dedupe for discovery / parallel triggers (Firestore + FCM). */
export function tryAcquireIncomingCall(callId: string, source: string): boolean {
  if (acceptedCallIds.has(callId)) {
    if (__DEV__) {
      console.log('[CALL] incoming acquire blocked — accepted', { source, callId });
    }
    return false;
  }
  const now = Date.now();
  pruneAcquire(now);
  const allowed = !acquireEntries.has(callId);
  if (allowed) acquireEntries.set(callId, now);
  if (__DEV__) {
    console.log('[CALL] incoming acquire', {
      source,
      callId,
      allowed,
      duplicate: !allowed,
    });
  }
  return allowed;
}

/** @deprecated Use markCallDismissed / markCallAccepted */
export function releaseIncomingCall(callId?: string | null, reason = 'unknown'): void {
  if (!callId) return;
  if (reason.includes('accepted') || reason.includes('answered')) {
    markCallAccepted(callId, reason);
    return;
  }
  markCallDismissed(callId);
  if (__DEV__) {
    console.log('[CALL] incoming release', { callId, reason });
  }
}
