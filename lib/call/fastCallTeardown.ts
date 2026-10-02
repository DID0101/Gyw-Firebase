/**
 * Instant call teardown — UI/audio/native first; Firestore/WebRTC async.
 *
 * Filter logs: CALL_TERMINATION_
 */

import { NativeModules, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { markCallDismissed } from '@/lib/call/incomingCallGuard';
import { clearIncomingNavigationLock } from '@/lib/call/openIncomingCall';
import { endAllCalls, endCall } from '@/lib/callkeep';
import type { CallEndReason } from '@/lib/services/callService';
import { webRTCService } from '@/lib/services/webrtcService';
import { useCallManagerStore } from '@/store/callManagerStore';
import { useCallStore } from '@/store/callStore';

const endingCalls = new Set<string>();

export function isCallEnding(callId: string): boolean {
  return endingCalls.has(callId);
}

function logTeardown(tag: string, callId: string, ms?: number): void {
  const delta = ms != null ? ` ms=${ms}` : '';
  console.log(`${tag} callId=${callId}${delta}`);
}

type TeardownOptions = {
  chatId?: string;
  duration?: number;
  /** Skip native IncomingCallModule dismiss (e.g. already on call screen only). */
  skipNativeDismiss?: boolean;
};

/**
 * Synchronous + fire-and-forget: stop audio, dismiss native UI, reset stores, cleanup RTC/FS in background.
 */
export function teardownCallImmediately(
  callId: string,
  reason: CallEndReason,
  options?: TeardownOptions,
): void {
  if (!callId) return;
  if (endingCalls.has(callId)) {
    logTeardown('CALL_ALREADY_ENDING', callId);
    return;
  }
  endingCalls.add(callId);

  const t0 = Date.now();
  logTeardown('CALL_TERMINATION_START', callId);
  logTeardown('END_CALL_CLICK', callId);

  // ── 1. Audio / ring (instant) ─────────────────────────────────────────────
  logTeardown('STOP_RING_START', callId);
  try {
    InCallManager.stopRingtone();
  } catch {
    /* ignore */
  }
  try {
    InCallManager.stop();
  } catch {
    /* ignore */
  }

  // ── 2. Native: ring, notification, FGS, Telecom, IncomingCallActivity ───
  if (Platform.OS === 'android' && !options?.skipNativeDismiss) {
    try {
      const mod = NativeModules.IncomingCallModule as
        | { fastDismissCall?: (id: string) => void }
        | undefined;
      mod?.fastDismissCall?.(callId);
    } catch {
      /* ignore */
    }
  }

  try {
    endCall(callId);
    endAllCalls();
    logTeardown('NOTIFICATION_CANCEL', callId, Date.now() - t0);
  } catch {
    /* ignore */
  }

  // ── 3. JS stores (instant) ───────────────────────────────────────────────
  try {
    markCallDismissed(callId);
    useCallStore.getState().clearActiveCall();
    useCallStore.getState().clearIncomingCall();
    useCallManagerStore.getState().reset();
    clearIncomingNavigationLock(callId);
  } catch {
    /* ignore */
  }

  // ── 4. WebRTC (background) ────────────────────────────────────────────────
  logTeardown('RTC_CLOSE_START', callId);
  void Promise.resolve().then(() => {
    try {
      webRTCService.cleanup(callId);
      logTeardown('PEER_DESTROYED', callId, Date.now() - t0);
    } catch {
      /* ignore */
    }
  });

  // ── 5. Firestore + cancel push (background) ───────────────────────────────
  void endCallSessionBackground(callId, reason, options).finally(() => {
    logTeardown('FULL_CLEANUP_DONE', callId, Date.now() - t0);
    setTimeout(() => endingCalls.delete(callId), 5000);
  });
}

/** Firestore + CF only — never blocks UI. */
async function endCallSessionBackground(
  callId: string,
  reason: CallEndReason,
  options?: TeardownOptions,
): Promise<void> {
  const t0 = Date.now();
  try {
    const { updateCallStatus } = await import('@/lib/services/callService');
    const status =
      reason === 'cancelled' ? 'canceled' : reason === 'declined' ? 'declined' : 'ended';
    await updateCallStatus(callId, status, options?.duration, options?.chatId);
    logTeardown('FIRESTORE_UPDATE_DONE', callId, Date.now() - t0);

    try {
      const { auth, functions, httpsCallable } = await import('@/lib/firebase');
      const uid = auth?.currentUser?.uid;
      if (uid) {
        const endFn = httpsCallable<{ roomId: string; callerId: string }, { success: boolean }>(
          functions,
          'endCall',
        );
        const { withNetworkSafety } = await import('@/lib/safeNetwork');
        await withNetworkSafety(() => endFn({ roomId: callId, callerId: uid }), {
          label: 'end_call_fcm_cancel',
          timeoutMs: 6000,
          maxAttempts: 1,
        });
      }
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    if (__DEV__) console.warn('[fastCallTeardown] background end failed', callId, err);
  }
}
