/**
 * lib/hooks/useCallManager.ts
 *
 * React hook that owns the full call lifecycle:
 *   • Initialises callkeep (RNCallKeep) and NotificationService when the
 *     authenticated user is present.
 *   • Navigates to the correct call screen when an incoming call arrives.
 *   • Exposes imperative actions (answerCall, rejectCall, endCall) that
 *     update Firestore and dismiss the native call UI atomically.
 *
 * Place this hook in a single top-level component — HomeLayout or AppContent —
 * so it is mounted for the lifetime of the authenticated session.
 *
 * @example
 * ```tsx
 * // app/(home)/_layout.tsx
 * const { incomingCall } = useCallManager();
 * ```
 *
 * @module useCallManager
 */

import { useCallback, useEffect, useRef } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import {
  setupCallKeep,
  teardownCallKeep,
  displayIncomingCall,
  answerIncomingCall,
  rejectCall as callKeepReject,
  endCall as callKeepEnd,
  endAllCalls as callKeepEndAll,
} from '@/lib/callkeep';
import { setupForegroundHandler } from '@/lib/services/NotificationService';
import {
  useCallManagerStore,
  type CallManagerStatus,
  type IncomingCallInfo,
  type OutgoingCallInfo,
} from '@/store/callManagerStore';
import { useCallSessionStore } from '@/store/callSessionStore';
import { updateCallStatus } from '@/lib/services/callService';
import { releaseIncomingCall } from '@/lib/call/incomingCallGuard';

/** Imperative API for screens that must not mount a second `useCallManager` (e.g. incoming). */
export const callManagerActionsRef = {
  answerCall: async (_callId?: string) => {},
  rejectCall: async (_callId?: string) => {},
  endCall: async (_callId?: string) => {},
};

// ── Public return type ────────────────────────────────────────────────────────

export interface UseCallManagerReturn {
  /** Non-null while an incoming call is ringing. */
  incomingCall:  IncomingCallInfo | null;
  /** Non-null while an outgoing call is dialling. */
  outgoingCall:  OutgoingCallInfo | null;
  /** Current call lifecycle phase. */
  callStatus:    CallManagerStatus;
  /**
   * Accept the current incoming call.
   * Navigates to the call screen, tells CallKit the call was answered, and
   * clears the incoming-call state.
   *
   * @param callId - Override the call id (defaults to incomingCall.callId).
   */
  answerCall:    (callId?: string) => Promise<void>;
  /**
   * Reject the current incoming call without answering.
   * Updates Firestore status to 'rejected' and dismisses the native UI.
   *
   * @param callId - Override the call id.
   */
  rejectCall:    (callId?: string) => Promise<void>;
  /**
   * End an active or pending call.
   * Updates Firestore status to 'ended' and dismisses the native UI.
   *
   * @param callId - Override the call id.
   */
  endCall:       (callId?: string) => Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Mount once in the authenticated layout. Manages the full call lifecycle.
 */
export function useCallManager(): UseCallManagerReturn {
  const { user }  = useAuth();
  const router    = useRouter();

  // ── Zustand selectors ──────────────────────────────────────────────────────
  const incomingCall   = useCallManagerStore((s) => s.incomingCall);
  const outgoingCall   = useCallManagerStore((s) => s.outgoingCall);
  const callStatus     = useCallManagerStore((s) => s.callStatus);
  const answeredCallId = useCallManagerStore((s) => s.answeredCallId);
  const clearCall      = useCallManagerStore((s) => s.clearCall);

  // Refs so callbacks closed over them always see the latest values.
  const incomingRef = useRef(incomingCall);
  const outgoingRef = useRef(outgoingCall);

  useEffect(() => { incomingRef.current = incomingCall; }, [incomingCall]);
  useEffect(() => { outgoingRef.current = outgoingCall; }, [outgoingCall]);

  // ── callkeep + FCM foreground setup ───────────────────────────────────────
  //
  // Only on native; idempotent.  Tears down when user signs out.

  useEffect(() => {
    if (!user?.uid || Platform.OS === 'web') return;

    void setupCallKeep(
      router,
      // onAnswerCall — CallKit / Telecom answered → navigate to call screen
      (callId) => {
        if (useCallSessionStore.getState().shouldNavigateToIncomingCall(callId)) {
          router.push(`/(home)/call/${callId}?accept=1` as any);
        }
      },
      // onEndCall — CallKit / Telecom ended → clear store
      () => { clearCall(); },
    );

    const unsubForeground = setupForegroundHandler();

    return () => {
      unsubForeground();
      teardownCallKeep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Android 13+: POST_NOTIFICATIONS is required for incoming-call heads-up + full-screen UI.
  useEffect(() => {
    if (!user?.uid || Platform.OS !== 'android') return;

    void (async () => {
      try {
        if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
        }
        ensureCallKeepNativeReady();
      } catch (_) {
        /* non-fatal */
      }
    })();
  }, [user?.uid]);

  // ── Navigate when a new incoming call arrives ─────────────────────────────

  useEffect(() => {
    if (!incomingCall) return;

    const { callId, callerName, callType } = incomingCall;

    if (!useCallSessionStore.getState().shouldNavigateToIncomingCall(callId)) return;

    if (Platform.OS === 'android') {
      // Android: ringing UI is native (FCM → GywIncomingCallService → IncomingCallActivity).
      // Do not router.push to /call/[id] here — that mounts WebRTC CallScreen while Telecom
      // + native incoming UI are active, which can crash or confuse lifecycle; accept uses gyw://.
      return;
    }
    if (Platform.OS === 'ios') {
      // iOS: CallKit shows system UI when app is in background/killed.
      // When app is foregrounded by the user, show our in-app screen.
      displayIncomingCall(callId, callerName, callType);
      try {
        router.push({
          pathname: '/(home)/call/incoming' as any,
          params: {
            callId,
            callerName,
            callerAvatar: incomingCall.callerAvatar ?? '',
            callType,
          },
        });
      } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall?.callId]);

  // ── answerCall ────────────────────────────────────────────────────────────

  const answerCall = useCallback(
    async (callId?: string): Promise<void> => {
      const id = callId ?? incomingRef.current?.callId;
      if (!id) return;

      answerIncomingCall(id);
      releaseIncomingCall(id, 'answered_useCallManager');
      clearCall();

      try {
        router.replace(`/(home)/call/${id}?accept=1` as any);
      } catch (_) {}
    },
    [router, clearCall],
  );

  // ── rejectCall ────────────────────────────────────────────────────────────

  const rejectCall = useCallback(
    async (callId?: string): Promise<void> => {
      const id = callId ?? incomingRef.current?.callId;
      if (!id) return;

      clearCall();
      callKeepReject(id);
      callKeepEndAll();
      releaseIncomingCall(id, 'declined_useCallManager');

      try {
        await updateCallStatus(id, 'rejected');
      } catch (err) {
        if (__DEV__) console.warn('[useCallManager] rejectCall update failed', err);
      }
    },
    [clearCall],
  );

  // ── endCall ───────────────────────────────────────────────────────────────

  const endCall = useCallback(
    async (callId?: string): Promise<void> => {
      const id =
        callId ??
        outgoingRef.current?.callId ??
        incomingRef.current?.callId ??
        answeredCallId;
      if (!id) return;

      clearCall();
      callKeepEnd(id);
      callKeepEndAll();
      releaseIncomingCall(id, 'ended_useCallManager');

      try {
        await updateCallStatus(id, 'ended');
      } catch (err) {
        if (__DEV__) console.warn('[useCallManager] endCall update failed', err);
      }
    },
    [clearCall, answeredCallId],
  );

  useEffect(() => {
    callManagerActionsRef.answerCall = answerCall;
    callManagerActionsRef.rejectCall = rejectCall;
    callManagerActionsRef.endCall = endCall;
  }, [answerCall, rejectCall, endCall]);

  return { incomingCall, outgoingCall, callStatus, answerCall, rejectCall, endCall };
}
