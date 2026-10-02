/**
 * lib/hooks/useCallManager.ts
 *
 * Single Firestore listener for the active call doc. FCM only wakes native UI.
 * Firestore status is authoritative; Zustand mirrors it.
 */

import { useCallback, useEffect, useRef } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { useAuth } from '@/contexts/AuthContext';
import { hasNativeFirestore } from '@/lib/firestoreNative';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';
import {
  setupCallKeep,
  teardownCallKeep,
  ensureCallKeepNativeReady,
  answerIncomingCall,
  endAllCalls as callKeepEndAll,
} from '@/lib/callkeep';
import { setupForegroundHandler } from '@/lib/services/NotificationService';
import {
  endCallSession,
  getCall,
  subscribeToCall,
  updateCallStatus,
} from '@/lib/services/callService';
import {
  acceptFlowLogCalleeSnapshot,
  acceptFlowLogCallerSnapshot,
} from '@/lib/call/acceptFlowTrace';
import { logCallDismissingIncoming, logCallStatusChanged } from '@/lib/call/callDevLog';
import { handleAnswerCallNavigation } from '@/lib/call/handleAnswerCallNavigation';
import {
  clearIncomingNavigationLock,
  openIncomingCallScreen,
} from '@/lib/call/openIncomingCall';
import {
  isCallAcceptedLocally,
  markCallAccepted,
  markCallDismissed,
  releaseIncomingCall,
  tryAcquireIncomingCall,
} from '@/lib/call/incomingCallGuard';
import { logIncomingUiBlocked } from '@/lib/call/incomingUiTrace';
import { db } from '@/lib/firebase';
import { useCallManagerStore } from '@/store/callManagerStore';
import { callDocToIncomingStore, useCallStore } from '@/store/callStore';
import { useCallSessionStore } from '@/store/callSessionStore';
import type { Call } from '@/lib/types/call';

export const callManagerActionsRef = {
  answerCall: async (_callId?: string) => {},
  rejectCall: async (_callId?: string) => {},
  endCall: async (_callId?: string) => {},
};

export interface UseCallManagerReturn {
  incomingCall: ReturnType<typeof useCallManagerStore.getState>['incomingCall'];
  outgoingCall: ReturnType<typeof useCallManagerStore.getState>['outgoingCall'];
  callStatus: ReturnType<typeof useCallManagerStore.getState>['callStatus'];
  answerCall: (callId?: string) => Promise<void>;
  rejectCall: (callId?: string) => Promise<void>;
  endCall: (callId?: string) => Promise<void>;
}

const TERMINAL = new Set([
  'ended',
  'missed',
  'declined',
  'rejected',
  'busy',
  'canceled',
  'cancelled',
  'timeout',
]);

export function useCallManager(): UseCallManagerReturn {
  const { user } = useAuth();
  const router = useRouter();

  const incomingCall = useCallManagerStore((s) => s.incomingCall);
  const outgoingCall = useCallManagerStore((s) => s.outgoingCall);
  const callStatus = useCallManagerStore((s) => s.callStatus);
  const activeCallId = useCallManagerStore((s) => s.activeCallId);

  const lastHandledStatus = useRef<string | null>(null);
  const previousStatus = useRef<string | null>(null);
  const selfUidRef = useRef<string | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;
  useEffect(() => {
    selfUidRef.current = user?.uid ?? null;
  }, [user?.uid]);

  // ── CallKeep + foreground FCM (wake-only) ─────────────────────────────────
  useEffect(() => {
    if (!user?.uid || Platform.OS === 'web') return;

    void setupCallKeep(
      router,
      (callId) => {
        useCallManagerStore.getState().setActiveCallId(callId);
        if (useCallSessionStore.getState().shouldNavigateToIncomingCall(callId)) {
          router.replace(`/(home)/call/${callId}?accept=1` as any);
        }
      },
      () => {
        const id = useCallManagerStore.getState().activeCallId;
        if (id) void endCallSession(id, 'ended');
      },
    );

    const unsubForeground = setupForegroundHandler();
    return () => {
      unsubForeground();
      teardownCallKeep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

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

  useEffect(() => {
    lastHandledStatus.current = null;
    previousStatus.current = null;
  }, [activeCallId]);

  // ── Discover ringing calls for callee (sets activeCallId only — no navigation) ─
  useEffect(() => {
    if (!user?.uid) return;

    const uid = user.uid;
    const onDiscovered = (callId: string) => {
      void (async () => {
        const call = await getCall(callId);
        if (!call || call.callerId === uid) {
          if (__DEV__ && call?.callerId === uid) {
            console.log('[CALL] discovery skip — own outgoing call', { callId });
          }
          return;
        }
        if (isCallAcceptedLocally(callId)) {
          logIncomingUiBlocked('firestore_discovery', callId, 'accepted_locally');
          return;
        }
        if (!tryAcquireIncomingCall(callId, 'firestore_discovery')) return;
        useCallManagerStore.getState().setActiveCallId(callId);
      })();
    };

    if (Platform.OS !== 'web' && hasNativeFirestore && hasRnFirebase) {
      let rnFirestoreMod: typeof import('@react-native-firebase/firestore') | null = null;
      try {
        rnFirestoreMod = require('@react-native-firebase/firestore');
      } catch {
        return;
      }
      if (!rnFirestoreMod) return;

      const rnDb = getRnFirestore();
      const callsRef = rnFirestoreMod.collection(rnDb, 'calls');
      const q = rnFirestoreMod.query(
        callsRef,
        rnFirestoreMod.where('calleeId', '==', uid),
        rnFirestoreMod.where('status', '==', 'ringing'),
      );
      return rnFirestoreMod.onSnapshot(
        q,
        { includeMetadataChanges: false },
        (snap: { docChanges: () => { type: string; doc: { id: string } }[] }) => {
          snap.docChanges().forEach((change) => {
            if (change.type === 'added') onDiscovered(change.doc.id);
          });
        }
      );
    }

    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', uid),
      where('status', '==', 'ringing'),
    );

    return onSnapshot(
      q,
      { includeMetadataChanges: false },
      (snap) => {
        snap.docChanges().forEach((change) => {
          if (change.type === 'added') onDiscovered(change.doc.id);
        });
      }
    );
  }, [user?.uid]);

  // ── Authoritative listener: calls/{activeCallId} ─────────────────────────
  // Do NOT depend on `router` — navigation changes would reset lastHandledStatus and re-open ringing UI.
  useEffect(() => {
    if (!user?.uid || !activeCallId) return;

    const pendingTimers: ReturnType<typeof setTimeout>[] = [];
    const unsub = subscribeToCall(activeCallId, (call) => {
      if (!call) {
        pendingTimers.push(
          setTimeout(() => {
            useCallStore.getState().clearActiveCall();
            useCallManagerStore.getState().reset();
            useCallStore.getState().clearIncomingCall();
            clearIncomingNavigationLock(activeCallId);
          }, 300)
        );
        return;
      }

      useCallStore.getState().setCallData(call);
      useCallManagerStore.getState().syncFromCallDoc(call, user.uid);

      const status = call.status;
      const priorStatus = previousStatus.current;
      if (previousStatus.current !== status) {
        logCallStatusChanged(call.id, previousStatus.current ?? undefined, status);
        previousStatus.current = status;
      }
      if (status === lastHandledStatus.current) return;
      lastHandledStatus.current = status;

      const selfUid = selfUidRef.current;
      if (!selfUid) return;

      const isCallee =
        call.receiverId === selfUid ||
        (call as Call & { calleeId?: string }).calleeId === selfUid;
      const isCaller = call.callerId === selfUid;

      if (isCaller) {
        acceptFlowLogCallerSnapshot(call.id, status, { source: 'useCallManager' });
      } else if (isCallee) {
        acceptFlowLogCalleeSnapshot(call.id, status, { source: 'useCallManager' });
      }

      if (status === 'ringing' && isCallee) {
        if (isCallAcceptedLocally(call.id)) {
          logIncomingUiBlocked('firestore_active_listener', call.id, 'accepted_locally', {
            status,
          });
          return;
        }
        const mgrStatus = useCallManagerStore.getState().callStatus;
        if (
          ['connecting', 'active'].includes(mgrStatus) ||
          useCallManagerStore.getState().answeredCallId === call.id
        ) {
          if (__DEV__) {
            console.warn('[CALL] skip incoming UI — already past ringing', {
              callId: call.id,
              mgrStatus,
            });
          }
          return;
        }
        const payload = callDocToIncomingStore(call);
        useCallStore.getState().setIncomingCall(payload);
        void openIncomingCallScreen(routerRef.current, payload, 'firestore_active_listener');
        return;
      }

      if (
        (status === 'accepted' || status === 'answered') &&
        isCallee &&
        priorStatus === 'ringing'
      ) {
        markCallAccepted(call.id, 'firestore_accepted_status');
        useCallManagerStore.getState().markCalleeAnswered(call.id);
        answerIncomingCall(call.id);
        releaseIncomingCall(call.id, 'accepted_firestore');
        const mediaType =
          call.type === 'video' ||
          (call as Call & { callType?: string }).callType === 'video'
            ? 'video'
            : 'audio';
        void handleAnswerCallNavigation(routerRef.current, {
          callId: call.id,
          callType: mediaType,
        });
        return;
      }

      if (TERMINAL.has(status)) {
        markCallDismissed(call.id);
        releaseIncomingCall(call.id, `terminal_${status}`);
        callKeepEndAll();
        useCallManagerStore.getState().setActiveCallId(null);
        if (useCallStore.getState().incomingCall?.callId === call.id) {
          logCallDismissingIncoming(`terminal_${status}`, { callId: call.id, status });
          useCallStore.getState().setIncomingCall(callDocToIncomingStore(call));
        }
        pendingTimers.push(
          setTimeout(() => {
            useCallStore.getState().clearActiveCall();
            useCallManagerStore.getState().reset();
            useCallStore.getState().clearIncomingCall();
            clearIncomingNavigationLock(call.id);
          }, 300)
        );
      }
    });

    return () => {
      unsub();
      pendingTimers.forEach(clearTimeout);
    };
  }, [user?.uid, activeCallId]);

  const answerCall = useCallback(
    async (callId?: string): Promise<void> => {
      const id = callId ?? useCallManagerStore.getState().activeCallId;
      if (!id || !user?.uid) return;

      console.log('CALL_STATUS_ACCEPT_REQUEST', { callId: id });
      markCallAccepted(id, 'answerCall');
      useCallManagerStore.getState().markCalleeAnswered(id);
      answerIncomingCall(id);
      releaseIncomingCall(id, 'answered_useCallManager');
      void updateCallStatus(id, 'accepted')
        .then(() => {
          console.log('CALL_STATUS_FIRESTORE_SUCCESS', { callId: id, status: 'accepted' });
        })
        .catch((err) => {
          if (__DEV__) console.warn('[useCallManager] answer status update failed', err);
          console.log('CALL_STATUS_FIRESTORE_WRITE', { callId: id, error: String(err) });
        });
      // WebRTC + transition to active happen on the call screen (accept=1), once per call.
    },
    [router, user?.uid],
  );

  const rejectCall = useCallback(async (callId?: string): Promise<void> => {
    const id = callId ?? useCallManagerStore.getState().activeCallId;
    if (!id) return;
    endCallSession(id, 'declined');
  }, []);

  const endCall = useCallback(
    async (callId?: string): Promise<void> => {
      const id = callId ?? useCallManagerStore.getState().activeCallId;
      if (!id) return;

      const call = useCallStore.getState().activeCall;
      const reason =
        call?.status === 'ringing' && call.callerId === user?.uid ? 'cancelled' : 'ended';
      endCallSession(id, reason);
    },
    [user?.uid],
  );

  useEffect(() => {
    callManagerActionsRef.answerCall = answerCall;
    callManagerActionsRef.rejectCall = rejectCall;
    callManagerActionsRef.endCall = endCall;
  }, [answerCall, rejectCall, endCall]);

  return { incomingCall, outgoingCall, callStatus, answerCall, rejectCall, endCall };
}
