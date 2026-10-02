import { Platform } from 'react-native';
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db, functions, httpsCallable } from '@/lib/firebase';
import {
  createCallNative,
  getCallHistoryNative,
  getCallNative,
  hasNativeFirestore,
  fetchPendingSignalingForCalleeNative,
  sendSignalingMessageNative,
  subscribeToCallNative,
  subscribeToSignalingNative,
  updateCallReceiverReadyNative,
  updateCallStatusNative,
} from '@/lib/firestoreNative';
import { Call, CallSignaling } from '@/lib/types/call';
import { runOnceByKey } from '@/lib/safeAction';
import { withNetworkSafety } from '@/lib/safeNetwork';
import { isCallEnding, teardownCallImmediately } from '@/lib/call/fastCallTeardown';
import { callLatencyMark, callLatencyStart } from '@/lib/perf/callLatencyTrace';
import { useCallManagerStore } from '@/store/callManagerStore';

function csLog(...args: unknown[]) {
  if (__DEV__) console.log(...args);
}
function csWarn(...args: unknown[]) {
  if (__DEV__) console.warn(...args);
}

export interface CreateCallOptions {
  chatId?: string;
  /** Omegle-style random video chat; no chat/call log. */
  isRandom?: boolean;
}

const TERMINAL_STATUSES = new Set([
  'ended',
  'missed',
  'declined',
  'rejected',
  'busy',
  'canceled',
  'cancelled',
  'timeout',
]);

export type CallEndReason = 'cancelled' | 'ended' | 'declined';

export type InitiateCallParams = {
  /** Pre-generated Firestore doc id — use for navigate-first outgoing calls. */
  callId?: string;
  callerId: string;
  calleeId: string;
  callType: 'audio' | 'video';
  chatId?: string;
  callerName?: string;
  callerAvatar?: string;
  isRandom?: boolean;
};

/** Client-side call doc id — no network. */
export function preGenerateCallId(): string {
  return doc(collection(db, 'calls')).id;
}

const RING_TIMEOUT_SECS = 60;
const CALL_DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rules-compliant ringing stub so listeners work before the CF finishes.
 * Safe to call before navigate-first outgoing UI.
 */
export async function writeOutgoingCallStub(params: InitiateCallParams & { callId: string }): Promise<void> {
  const { callId, callerId, calleeId, callType, chatId, callerName, callerAvatar } = params;
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + RING_TIMEOUT_SECS * 1000);
  const deleteAfter = Timestamp.fromMillis(now + CALL_DELETE_AFTER_MS);
  const normalizedType: 'audio' | 'video' = callType === 'video' ? 'video' : 'audio';

  const callData: Record<string, unknown> = {
    callId,
    callerId,
    calleeId,
    receiverId: calleeId,
    callType: normalizedType,
    type: normalizedType,
    status: 'ringing',
    ringTimeoutSecs: RING_TIMEOUT_SECS,
    callerName: (callerName ?? '').trim() || 'Unknown Caller',
    callerAvatar: callerAvatar ?? '',
    deferIncomingPush: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt,
    deleteAfter,
  };
  if (chatId) callData.chatId = chatId;

  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await createCallNative(
      callerId,
      calleeId,
      normalizedType,
      chatId,
      false,
      callerName,
      callerAvatar,
      callId,
    );
    return;
  }

  await setDoc(doc(db, 'calls', callId), callData);
  callLatencyMark(callId, 'CALL_DOC_CREATED');
}

/** In-flight initiation guard — blocks double-tap without debounce latency. */
const initiateCallInFlight = new Map<string, Promise<string>>();

function releaseInitiateCallKey(key: string): void {
  setTimeout(() => initiateCallInFlight.delete(key), 5000);
}

/** Wake callee immediately — do not wait for WebRTC offer / getUserMedia. */
async function notifyCalleeRinging(callId: string): Promise<void> {
  const notifyFn = httpsCallable<{ roomId: string }, { success: boolean }>(
    functions,
    'notifyIncomingCall',
  );
  try {
    await withNetworkSafety(() => notifyFn({ roomId: callId }), {
      label: 'notify_incoming_call',
      timeoutMs: 8000,
      maxAttempts: 2,
    });
    callLatencyMark(callId, 'FCM_SENT');
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'not-found' || code === 'functions/not-found') {
      csWarn(
        '[callService] notifyIncomingCall not deployed — callee may rely on Firestore only',
        callId,
      );
    } else {
      csWarn('[callService] notifyIncomingCall failed (non-fatal)', err);
    }
  }
}

/** Caller SDP offer — runs in parallel with notifyCalleeRinging when possible. */
async function finalizeOutgoingOffer(
  callId: string,
  callerId: string,
  receiverId: string,
): Promise<void> {
  try {
    const { webRTCService } = await import('./webrtcService');
    await webRTCService.createAndSendOffer(callId, callerId, receiverId);
  } catch (err) {
    csWarn('[callService] finalizeOutgoingOffer failed', err);
  }
}

/** Offer + ring push — ring is not blocked on media/SDP. */
async function finalizeOutgoingOfferAndNotify(
  callId: string,
  callerId: string,
  receiverId: string,
): Promise<void> {
  await Promise.all([
    notifyCalleeRinging(callId),
    finalizeOutgoingOffer(callId, callerId, receiverId),
  ]);
}

const normalizeCallStatus = (status: string | undefined): Call['status'] => {
  if (!status) return 'ringing';
  if (status === 'answered') return 'accepted' as Call['status'];
  if (status === 'rejected') return 'declined' as Call['status'];
  if (status === 'cancelled') return 'canceled' as Call['status'];
  return status as Call['status'];
};

function isCallEligibleForHistory(call: Call): boolean {
  if (call.isRandom) return false;
  if (call.endedAt) return true;
  return TERMINAL_STATUSES.has(call.status);
}

/**
 * Start an outgoing call (fast path).
 *
 * 1. Pre-generate callId
 * 2. Start WebRTC / ICE prep in parallel with Firestore write
 * 3. Create offer + persist SDP on call doc
 * 4. notifyIncomingCall CF sends data-only FCM (after media is ready)
 */
export const initiateCall = async (params: InitiateCallParams): Promise<string> => {
  const {
    callId: preCallId,
    callerId,
    calleeId: receiverId,
    callType,
    chatId,
    callerName,
    callerAvatar,
    isRandom,
  } = params;
  const normalizedType: 'audio' | 'video' = callType === 'video' ? 'video' : 'audio';
  const opts: CreateCallOptions = {
    ...(chatId ? { chatId } : {}),
    ...(isRandom ? { isRandom: true } : {}),
  };
  const roomId = preCallId ?? preGenerateCallId();
  const dedupeKey =
    preCallId ??
    [
      'start_call',
      callerId,
      receiverId,
      normalizedType,
      opts.chatId ?? '',
      opts.isRandom ? 'random' : 'regular',
    ].join(':');

  const inFlight = initiateCallInFlight.get(dedupeKey);
  if (inFlight) {
    if (__DEV__) csLog('[callService] CALL_INIT_IN_FLIGHT — joining existing', { dedupeKey });
    return inFlight;
  }

  const promise = (async (): Promise<string> => {
    const isVideo = normalizedType === 'video';
    const { beginOutgoingCallerMediaPrep } = await import('./webrtcService');

    let docExists = false;
    try {
      docExists = !!(await getCall(roomId));
    } catch {
      docExists = false;
    }

    if (!opts.isRandom) {
      try {
        const initiateCallFn = httpsCallable<
          {
            callerId: string;
            calleeId: string;
            roomId: string;
            callType: 'audio' | 'video';
            callerName: string;
            callerAvatar: string;
            chatId?: string;
          },
          { success: boolean; roomId: string }
        >(functions, 'initiateCall');

        const writePromise = withNetworkSafety(
          () =>
            initiateCallFn({
              callerId,
              calleeId: receiverId,
              roomId,
              callType: normalizedType,
              callerName: callerName ?? '',
              callerAvatar: callerAvatar ?? '',
              ...(opts.chatId ? { chatId: opts.chatId } : {}),
            }),
          { label: 'initiate_call', timeoutMs: 12000, maxAttempts: 3 },
        );

        const [mediaPrepResult, cfResult] = await Promise.allSettled([
          beginOutgoingCallerMediaPrep(roomId, isVideo, callerId, receiverId),
          writePromise,
        ]);

        if (cfResult.status === 'rejected') {
          throw cfResult.reason;
        }
        if (mediaPrepResult.status === 'rejected') {
          csWarn('[callService] media prep failed (continuing audio-only path)', mediaPrepResult.reason);
        }

        const res = cfResult.value;
        if (res?.data?.success && res.data.roomId) {
          const callId = res.data.roomId;
          callLatencyMark(callId, 'CALL_DOC_CREATED');
          const { logCallInitiating } = await import('@/lib/call/callDevLog');
          logCallInitiating(callId, { callerId, receiverId, type: normalizedType });
          const { useCallManagerStore } = await import('@/store/callManagerStore');
          useCallManagerStore.getState().setActiveCallId(callId);
          // Ring callee immediately; SDP offer continues in parallel.
          void notifyCalleeRinging(callId);
          await finalizeOutgoingOffer(callId, callerId, receiverId);
          csLog('Call initiated (callable):', { roomId: callId, callerId, receiverId, type: normalizedType });
          return callId;
        }
        csWarn('[callService] initiateCall callable returned unsuccessful response');
      } catch (err) {
        csWarn('[callService] initiateCall callable failed, falling back to direct write', err);
      }
    }

    if (!docExists && Platform.OS !== 'web' && hasNativeFirestore) {
      const [nativeResult, mediaPrepResult] = await Promise.allSettled([
        createCallNative(
          callerId,
          receiverId,
          normalizedType,
          opts.chatId,
          opts.isRandom,
          callerName,
          callerAvatar,
          roomId,
        ),
        !opts.isRandom ? beginOutgoingCallerMediaPrep(roomId, isVideo, callerId, receiverId) : Promise.resolve(),
      ]);
      if (nativeResult.status === 'rejected') throw nativeResult.reason;
      if (mediaPrepResult.status === 'rejected') {
        csWarn('[callService] media prep failed (native path)', mediaPrepResult.reason);
      }
      const callId = nativeResult.value;
      const { logCallInitiating } = await import('@/lib/call/callDevLog');
      logCallInitiating(callId, { callerId, receiverId, type: normalizedType, path: 'native' });
      if (!opts.isRandom) {
        const { useCallManagerStore } = await import('@/store/callManagerStore');
        useCallManagerStore.getState().setActiveCallId(callId);
        callLatencyMark(callId, 'CALL_DOC_CREATED');
        void notifyCalleeRinging(callId);
        await finalizeOutgoingOffer(callId, callerId, receiverId);
      }
      csLog('Call created (native):', { callId, callerId, receiverId, type: normalizedType });
      return callId;
    }

    if (!docExists) {
      const now = Date.now();
      const callData: Record<string, unknown> = {
        callId: roomId,
        callerId,
        receiverId,
        calleeId: receiverId,
        type: normalizedType,
        callType: normalizedType,
        status: 'ringing',
        ringTimeoutSecs: RING_TIMEOUT_SECS,
        deferIncomingPush: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + RING_TIMEOUT_SECS * 1000),
        deleteAfter: Timestamp.fromMillis(now + CALL_DELETE_AFTER_MS),
      };
      if (opts.chatId) callData.chatId = opts.chatId;
      if (opts.isRandom) callData.isRandom = true;
      if (callerName) callData.callerName = callerName;
      if (callerAvatar) callData.callerAvatar = callerAvatar;

      const callDocRef = doc(collection(db, 'calls'), roomId);
      const [writeResult, mediaPrepResult] = await Promise.allSettled([
        setDoc(callDocRef, callData),
        !opts.isRandom ? beginOutgoingCallerMediaPrep(roomId, isVideo, callerId, receiverId) : Promise.resolve(),
      ]);

      if (writeResult.status === 'rejected') throw writeResult.reason;
      if (mediaPrepResult.status === 'rejected') {
        csWarn('[callService] media prep failed (direct write)', mediaPrepResult.reason);
      }
    } else if (!opts.isRandom) {
      const mediaPrepResult = await Promise.allSettled([
        beginOutgoingCallerMediaPrep(roomId, isVideo, callerId, receiverId),
      ]);
      if (mediaPrepResult[0].status === 'rejected') {
        csWarn('[callService] media prep failed (stub exists)', mediaPrepResult[0].reason);
      }
    }

    const { useCallManagerStore } = await import('@/store/callManagerStore');
    useCallManagerStore.getState().setActiveCallId(roomId);
    if (!opts.isRandom) {
      callLatencyMark(roomId, 'CALL_DOC_CREATED');
      void notifyCalleeRinging(roomId);
      await finalizeOutgoingOffer(roomId, callerId, receiverId);
    }
    const { logCallInitiating } = await import('@/lib/call/callDevLog');
    logCallInitiating(roomId, {
      callerId,
      receiverId,
      type: normalizedType,
      path: docExists ? 'stub_then_finalize' : 'direct_write',
    });
    return roomId;
  })();

  initiateCallInFlight.set(dedupeKey, promise);
  promise.finally(() => releaseInitiateCallKey(dedupeKey));
  return promise;
};

/** Positional wrapper for legacy import sites. */
export async function createCall(
  callerId: string,
  receiverId: string,
  type: 'audio' | 'video',
  chatId?: string,
  options?: CreateCallOptions,
  callerName?: string,
  callerAvatar?: string,
): Promise<string> {
  return initiateCall({
    callId: undefined,
    callerId,
    calleeId: receiverId,
    callType: type,
    chatId: chatId ?? options?.chatId,
    isRandom: options?.isRandom,
    callerName,
    callerAvatar,
  });
}

/**
 * End / cancel / decline — instant UI teardown; Firestore/WebRTC/FCM in background.
 */
export function endCallSession(
  callId: string,
  reason: CallEndReason,
  options?: { chatId?: string; duration?: number; skipNativeDismiss?: boolean },
): void {
  if (!callId) return;

  if (isCallEnding(callId)) {
    if (__DEV__) csWarn('[endCallSession] CALL_ALREADY_ENDING', callId);
    return;
  }

  const activeId = useCallManagerStore.getState().activeCallId;
  if (activeId && activeId !== callId) {
    if (__DEV__) {
      csWarn('[endCallSession] activeCallId mismatch — skipping stale end', {
        callId,
        activeCallId: activeId,
        reason,
      });
    }
    return;
  }

  teardownCallImmediately(callId, reason, options);
}

/** Accept incoming call — Firestore status update (non-blocking); navigate via handleAnswerCallNavigation. */
export async function acceptCall(callId: string): Promise<void> {
  const { callManagerActionsRef } = await import('@/lib/hooks/useCallManager');
  await callManagerActionsRef.answerCall(callId);
}

/** Decline incoming call — Firestore first, then clears stores. */
export async function declineCall(callId: string): Promise<void> {
  const { callManagerActionsRef } = await import('@/lib/hooks/useCallManager');
  await callManagerActionsRef.rejectCall(callId);
}

/** Signal that receiver has set up signaling and is ready for the offer (random calls only). */
export const updateCallReceiverReady = async (callId: string): Promise<void> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await updateCallReceiverReadyNative(callId);
    return;
  }
  const callRef = doc(db, 'calls', callId);
  await updateDoc(callRef, {
    receiverReady: true,
    receiverReadyAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/** Wait for receiver to be ready (random calls). Resolves when receiverReady or after timeout. */
export const waitForReceiverReady = (callId: string, timeoutMs: number = 8000): Promise<void> => {
  return new Promise((resolve) => {
    let resolved = false;
    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      unsub();
      resolve();
    };
    const timeout = setTimeout(doResolve, timeoutMs);
    const unsub = subscribeToCall(callId, (callData) => {
      if (callData?.receiverReady === true) doResolve();
    });
  });
};

// Update call status and create call log message
export const updateCallStatus = async (
  callId: string,
  status: Call['status'],
  duration?: number,
  chatId?: string
): Promise<void> => {
  const normalizedStatus = normalizeCallStatus(status as string);
  if (normalizedStatus === 'accepted' || normalizedStatus === 'active') {
    console.log('ACCEPT_FIRESTORE_UPDATE_START', { callId, normalizedStatus });
  }
  return runOnceByKey(
    ['call_status', callId, normalizedStatus, chatId ?? '', typeof duration === 'number' ? duration : ''].join(':'),
    async () => {
  // #region agent log
  if (normalizedStatus === 'declined' || normalizedStatus === 'rejected') {
    try {
      const { auth } = await import('@/lib/firebase');
      const { debugSessionLog } = await import('@/lib/debugSessionLog');
      debugSessionLog(
        'callService.ts:updateCallStatus',
        'terminal_status_write',
        { callId, normalizedStatus, selfUid: auth?.currentUser?.uid ?? null },
        'A',
      );
    } catch {}
  }
  // #endregion
  try {
    const transitionFn = httpsCallable<any, { success: true; status: string }>(functions, 'transitionCallState');
    await withNetworkSafety(
      () =>
        transitionFn({
          roomId: callId,
          nextStatus: normalizedStatus,
          ...(typeof duration === 'number' ? { duration } : {}),
        }),
      { label: `call_status:${normalizedStatus}`, timeoutMs: 10000, maxAttempts: 3 }
    );
    if (normalizedStatus === 'accepted' || normalizedStatus === 'active') {
      console.log('ACCEPT_FIRESTORE_UPDATE_SUCCESS', { callId, normalizedStatus, via: 'transitionCallState' });
    }
    return;
  } catch (err) {
    if (normalizedStatus === 'accepted') {
      console.log('ACCEPT_FIRESTORE_UPDATE_FAILED', { callId, via: 'transitionCallState', error: String(err) });
    }
    if (__DEV__) console.warn('[callService] transitionCallState callable failed, fallback to direct update', err);
  }

  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await withNetworkSafety(
      () => updateCallStatusNative(callId, normalizedStatus, duration, chatId),
      { label: `call_status_native:${normalizedStatus}`, timeoutMs: 10000, maxAttempts: 3 }
    );
    return;
  }

  const callRef = doc(db, 'calls', callId);
  const callDoc = await getDoc(callRef);
  
  if (!callDoc.exists()) {
    throw new Error('Call not found');
  }

  const callData = callDoc.data();
  const updateData: any = {
    status: normalizedStatus,
    updatedAt: serverTimestamp(),
  };

  if (TERMINAL_STATUSES.has(normalizedStatus)) {
    updateData.endedAt = serverTimestamp();
  }

  if (duration !== undefined) {
    updateData.duration = duration;
  }

  if (chatId) {
    updateData.chatId = chatId;
  }

  await updateDoc(callRef, updateData);

  // Create system message in chat if call ended/declined/missed (skip for random calls)
  if (
    chatId &&
    !callData?.isRandom &&
    (normalizedStatus === 'ended' || normalizedStatus === 'missed' || normalizedStatus === 'declined')
  ) {
    await createCallLogMessage(
      callId,
      callData,
      normalizedStatus as 'ended' | 'missed' | 'declined',
      duration || 0,
      chatId
    );
  }
    },
    {
      debounceMs: TERMINAL_STATUSES.has(normalizedStatus) ? 5000 : 1200,
      logLabel: `call_status:${normalizedStatus}`,
      blockedLog: 'CALL_DUPLICATE_PREVENTED',
    }
  );
};

// Create a system message for call log in chat
const createCallLogMessage = async (
  callId: string,
  callData: any,
  status: 'ended' | 'missed' | 'declined',
  duration: number,
  chatId: string
): Promise<void> => {
  try {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    
    // Determine message text based on status
    const callType = callData.type === 'video' ? '📹' : '📞';
    let messageText = '';
    
    if (status === 'missed') {
      messageText = `${callType} Missed ${callData.type} call`;
    } else if (status === 'declined') {
      messageText = `${callType} ${callData.type === 'video' ? 'Video' : 'Audio'} call • Rejected`;
    } else if (status === 'ended') {
      if (duration > 0) {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const durationText = minutes > 0 
          ? `${minutes}:${seconds.toString().padStart(2, '0')}`
          : `${seconds}s`;
        messageText = `${callType} ${callData.type === 'video' ? 'Video' : 'Audio'} call • ${durationText}`;
      } else {
        messageText = `${callType} ${callData.type === 'video' ? 'Video' : 'Audio'} call`;
      }
    }

    // Use caller's ID as senderId to pass security rules
    // The message is still a system message (type: 'call')
    // We need to get caller's name for senderName
    const { getUser } = await import('@/lib/services/chatService');
    const callerUser = await getUser(callData.callerId);
    const senderName = callerUser 
      ? `${callerUser.firstName} ${callerUser.lastName}`.trim() || callerUser.username
      : 'User';

    await addDoc(messagesRef, {
      chatId,
      senderId: callData.callerId, // Use caller's ID to pass security rules
      senderName: senderName,
      text: messageText,
      type: 'call', // This marks it as a system/call message
      callId,
      callType: callData.type,
      callStatus: status,
      callDuration: duration,
      readBy: [callData.callerId, callData.receiverId], // Mark as read by both participants
      createdAt: serverTimestamp(),
    });

    // Update chat's lastMessage to include call information
    const chatRef = doc(db, 'chats', chatId);
    await updateDoc(chatRef, {
      lastMessage: {
        text: messageText,
        senderId: callData.callerId,
        createdAt: new Date().toISOString(),
        type: 'call', // Mark as call message
        callType: callData.type,
        callStatus: status,
        callDuration: duration,
      },
      lastMessageAt: serverTimestamp(),
      lastSenderId: callData.callerId,
      updatedAt: serverTimestamp(),
    });

    // Increment unread for receiver on missed/rejected (they didn't see it)
    if (status === 'missed' || status === 'rejected') {
      const { incrementUnreadForOtherParticipants } = await import('@/lib/services/chatService');
      await incrementUnreadForOtherParticipants(chatId, callData.callerId);
    }
  } catch (error) {
    console.error('Error creating call log message:', error);
    // Don't throw - call status update should succeed even if message creation fails
  }
};

// Get call by ID
export const getCall = async (callId: string): Promise<Call | null> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return getCallNative(callId);
  }

  const callRef = doc(db, 'calls', callId);
  const callDoc = await getDoc(callRef);

  if (callDoc.exists()) {
    const data = callDoc.data();
    const normalizedType: 'audio' | 'video' =
      data.type === 'video' || data.callType === 'video' ? 'video' : 'audio';
    return {
      id: callDoc.id,
      ...data,
      type: normalizedType,
      status: normalizeCallStatus(data.status),
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      endedAt: data.endedAt?.toDate?.()?.toISOString() || data.endedAt,
    } as Call;
  }

  return null;
};

// Listen to call updates
export const subscribeToCall = (
  callId: string,
  callback: (call: Call | null) => void
): (() => void) => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return subscribeToCallNative(callId, callback);
  }
  const callRef = doc(db, 'calls', callId);
  return onSnapshot(
    callRef,
    { includeMetadataChanges: false },
    (callDoc) => {
      if (callDoc.exists()) {
        const data = callDoc.data();
        const normalizedType: 'audio' | 'video' =
          data.type === 'video' || data.callType === 'video' ? 'video' : 'audio';
        callback({
          id: callDoc.id,
          ...data,
          type: normalizedType,
          status: normalizeCallStatus(data.status),
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          endedAt: data.endedAt?.toDate?.()?.toISOString() || data.endedAt,
        } as Call);
      } else {
        callback(null);
      }
    },
    (error) => {
      const code = (error as { code?: string })?.code ?? '';
      if (__DEV__ && code !== 'permission-denied') {
        console.error('Error listening to call:', error);
      }
      // Do not treat transient listen errors as "call deleted" — avoids spurious safeBack.
    }
  );
};

// Send signaling message (offer, answer, ICE candidate)
export const sendSignalingMessage = async (
  callId: string,
  from: string,
  to: string,
  type: CallSignaling['type'],
  sdp?: RTCSessionDescriptionInit,
  candidate?: RTCIceCandidateInit,
  candidates?: RTCIceCandidateInit[],
): Promise<void> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      await sendSignalingMessageNative(callId, from, to, type, sdp, candidate, candidates);
      csLog(`Signaling ${type} sent from ${from} to ${to} (native)`);
      return;
    }
    const signalingRef = collection(db, 'callSignaling', callId, 'messages');
    await addDoc(signalingRef, {
      from,
      to,
      type,
      ...(sdp && { sdp }),
      ...(candidate && { candidate }),
      ...(candidates && candidates.length > 0 && { candidates }),
      timestamp: serverTimestamp(),
    });
    csLog(`Signaling ${type} sent from ${from} to ${to}`);
  } catch (error) {
    console.error(`Error sending signaling ${type}:`, error);
    throw error;
  }
};

/** Messages already written before callee subscribes (offer + queued ICE). */
export const fetchPendingSignalingForCallee = async (
  callId: string,
  calleeId: string,
): Promise<CallSignaling[]> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const rows = await fetchPendingSignalingForCalleeNative(callId, calleeId);
    return rows as CallSignaling[];
  }
  const signalingRef = collection(db, 'callSignaling', callId, 'messages');
  const q = query(signalingRef, where('to', '==', calleeId));
  const snapshot = await getDocs(q);
  const rows: Array<{ message: CallSignaling; ms: number }> = [];
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const ts = data.timestamp;
    const ms =
      ts && typeof (ts as { toDate?: () => Date }).toDate === 'function'
        ? (ts as { toDate: () => Date }).toDate().getTime()
        : typeof ts === 'string'
          ? Date.parse(ts)
          : 0;
    rows.push({
      ms,
      message: {
        callId,
        from: data.from,
        to: data.to,
        type: data.type,
        ...(data.sdp && { sdp: data.sdp }),
        ...(data.candidate && { candidate: data.candidate }),
        ...(Array.isArray(data.candidates) && { candidates: data.candidates }),
        timestamp: (ts as { toDate?: () => Date })?.toDate?.()?.toISOString() || ts,
      } as CallSignaling,
    });
  });
  rows.sort((a, b) => a.ms - b.ms);
  return rows.map((r) => r.message);
};

// Listen to signaling messages
export const subscribeToSignaling = (
  callId: string,
  userId: string,
  callback: (message: CallSignaling) => void
): (() => void) => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    csLog(`Subscribing to signaling for user ${userId} on call ${callId} (native)`);
    return subscribeToSignalingNative(callId, userId, callback);
  }
  const signalingRef = collection(db, 'callSignaling', callId, 'messages');
  const q = query(signalingRef);

  csLog(`Subscribing to signaling for user ${userId} on call ${callId}`);

  let initialSnapshot = true;
  return onSnapshot(
    q,
    { includeMetadataChanges: false },
    (snapshot) => {
      const changes = initialSnapshot
        ? snapshot.docs.map((docSnap) => ({ type: 'added' as const, doc: docSnap }))
        : snapshot.docChanges();
      initialSnapshot = false;
      changes.forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          
          // Only process messages intended for this user
          if (data.to === userId) {
            const message: CallSignaling = {
              callId,
              from: data.from,
              to: data.to,
              type: data.type,
              ...(data.sdp && { sdp: data.sdp }),
              ...(data.candidate && { candidate: data.candidate }),
              ...(Array.isArray(data.candidates) && { candidates: data.candidates }),
              timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp,
            };
            csLog(`Signaling ${message.type} received from ${message.from}`);
            callback(message);
          }
        }
      });
    },
    (error) => {
      if (error.code === 'permission-denied') {
        csWarn('Signaling permission denied - this is expected if call was ended/cleaned up');
      } else {
        console.error('Error listening to signaling:', error);
      }
    }
  );
};

/** Map Firestore call doc → UI `Call` (canonical `calleeId` + legacy `receiverId`). */
function firestoreCallDocToCall(docId: string, data: Record<string, any>, direction: 'incoming' | 'outgoing'): Call {
  const receiverId = String(data.receiverId ?? data.calleeId ?? '');
  const rawType = data.callType ?? data.type ?? 'audio';
  const type: 'audio' | 'video' = rawType === 'video' ? 'video' : 'audio';
  const createdRaw = data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt;
  const createdAt = typeof createdRaw === 'string' && createdRaw ? createdRaw : new Date(0).toISOString();
  const endedRaw = data.endedAt?.toDate?.()?.toISOString() ?? data.endedAt;
  const endedAt = typeof endedRaw === 'string' ? endedRaw : undefined;
  return {
    ...data,
    id: docId,
    receiverId,
    type,
    status: normalizeCallStatus(data.status),
    direction,
    createdAt,
    endedAt,
    duration: typeof data.duration === 'number' ? data.duration : undefined,
    chatId: data.chatId ?? undefined,
    isRandom: !!data.isRandom,
  } as Call;
}

/** users/{uid}/callHistory/{callId} → UI Call (durable; survives calls/ doc deletion). */
function callHistoryEntryToCall(userId: string, docId: string, data: Record<string, any>): Call | null {
  if (!data || data.isRandom === true) return null;
  const direction: 'incoming' | 'outgoing' = data.direction === 'outgoing' ? 'outgoing' : 'incoming';
  const peerId = String(data.peerId ?? '');
  const startedRaw =
    data.startedAt?.toDate?.()?.toISOString() ??
    data.startedAt ??
    data.createdAt?.toDate?.()?.toISOString() ??
    data.createdAt;
  const createdAt =
    typeof startedRaw === 'string' && startedRaw ? startedRaw : new Date(0).toISOString();
  const endedRaw = data.endedAt?.toDate?.()?.toISOString() ?? data.endedAt;
  const endedAt = typeof endedRaw === 'string' && endedRaw ? endedRaw : undefined;
  const callerId = direction === 'outgoing' ? userId : peerId;
  const receiverId = direction === 'outgoing' ? peerId : userId;
  const rawType = data.callType ?? data.type ?? 'audio';
  const type: 'audio' | 'video' = rawType === 'video' ? 'video' : 'audio';
  return {
    ...data,
    id: docId,
    callId: data.callId ?? docId,
    callerId,
    receiverId,
    type,
    status: normalizeCallStatus(data.status),
    direction,
    createdAt,
    endedAt,
    duration: typeof data.duration === 'number' ? data.duration : undefined,
    chatId: data.chatId ?? undefined,
    isRandom: false,
  } as Call;
}

// Get user's call history
export const getCallHistory = async (userId: string, limitCount: number = 50): Promise<Call[]> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return getCallHistoryNative(userId, limitCount) as Promise<Call[]>;
  }

  const byId = new Map<string, Call>();

  const histRef = collection(db, 'users', userId, 'callHistory');
  try {
    const histSnap = await getDocs(
      query(histRef, orderBy('startedAt', 'desc'), limit(limitCount))
    );
    histSnap.forEach((docSnap) => {
      const row = callHistoryEntryToCall(userId, docSnap.id, docSnap.data());
      if (row) byId.set(row.id, row);
    });
  } catch (e) {
    if (__DEV__) console.warn('[getCallHistory] ordered callHistory failed, fallback:', e);
    try {
      const histSnap = await getDocs(histRef);
      const rows: Call[] = [];
      histSnap.forEach((docSnap) => {
        const row = callHistoryEntryToCall(userId, docSnap.id, docSnap.data());
        if (row) rows.push(row);
      });
      rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      rows.slice(0, limitCount).forEach((row) => byId.set(row.id, row));
    } catch (e2) {
      if (__DEV__) console.warn('[getCallHistory] callHistory unreadable:', e2);
    }
  }

  const callsRef = collection(db, 'calls');
  const settled = await Promise.allSettled([
    getDocs(query(callsRef, where('callerId', '==', userId))),
    getDocs(query(callsRef, where('calleeId', '==', userId))),
    getDocs(query(callsRef, where('receiverId', '==', userId))),
  ]);

  settled.forEach((res, idx) => {
    if (res.status !== 'fulfilled') {
      if (__DEV__) console.warn('[getCallHistory] calls/ query failed:', idx, res.reason);
      return;
    }
    const direction = idx === 0 ? 'outgoing' : 'incoming';
    res.value.forEach((docSnap) => {
      if (byId.has(docSnap.id)) return;
      const row = firestoreCallDocToCall(docSnap.id, docSnap.data(), direction);
      if (isCallEligibleForHistory(row)) byId.set(docSnap.id, row);
    });
  });

  const calls = Array.from(byId.values());
  calls.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return calls.slice(0, limitCount);
};

// Generate a unique call link ID
const generateCallLinkId = (): string => {
  // Generate a random string similar to Signal (alphanumeric, easy to share)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars like 0, O, I, 1
  let linkId = '';
  for (let i = 0; i < 8; i++) {
    linkId += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return linkId;
};

// Create a call link
export const createCallLink = async (
  creatorId: string,
  type: 'audio' | 'video'
): Promise<{ linkId: string; linkUrl: string }> => {
  return runOnceByKey(
    ['create_call_link', creatorId, type].join(':'),
    async () => {
  // Generate unique link ID
  let linkId = generateCallLinkId();
  let attempts = 0;
  
  // Ensure uniqueness (check if link already exists)
  while (attempts < 10) {
    const existingLink = await getDoc(doc(db, 'callLinks', linkId));
    if (!existingLink.exists()) {
      break;
    }
    linkId = generateCallLinkId();
    attempts++;
  }
  
  if (attempts >= 10) {
    throw new Error('Failed to generate unique call link');
  }
  
  // Create call link document
  const linkData = {
    creatorId,
    type,
    status: 'active' as const,
    createdAt: serverTimestamp(),
    expiresAt: null, // Links don't expire by default (can be set later)
    participants: [],
  };
  
  await setDoc(doc(db, 'callLinks', linkId), linkData);
  
  // Generate shareable URL
  // Format: yourapp://call/[linkId] or https://yourapp.com/call/[linkId]
  const linkUrl = `https://signal-clone.app/call/${linkId}`;
  
  return { linkId, linkUrl };
    },
    {
      debounceMs: 2500,
      logLabel: 'create_call_link',
      blockedLog: 'CALL_DUPLICATE_PREVENTED',
    }
  );
};

// Get call link by ID
export const getCallLink = async (linkId: string): Promise<any | null> => {
  const linkRef = doc(db, 'callLinks', linkId);
  const linkDoc = await getDoc(linkRef);
  
  if (linkDoc.exists()) {
    const data = linkDoc.data();
    return {
      id: linkDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString() || data.expiresAt,
    };
  }
  
  return null;
};

// Join a call via link
export const joinCallLink = async (
  linkId: string,
  userId: string
): Promise<string> => {
  const linkRef = doc(db, 'callLinks', linkId);
  const linkDoc = await getDoc(linkRef);
  
  if (!linkDoc.exists()) {
    throw new Error('Call link not found');
  }
  
  const linkData = linkDoc.data();
  
  // Check if link is still active
  if (linkData.status !== 'active') {
    throw new Error('Call link is no longer active');
  }
  
  // Check expiration
  if (linkData.expiresAt) {
    const expiresAt = linkData.expiresAt.toDate();
    if (expiresAt < new Date()) {
      throw new Error('Call link has expired');
    }
  }
  
  // Add user to participants if not already added
  const participants = linkData.participants || [];
  if (!participants.includes(userId)) {
    await updateDoc(linkRef, {
      participants: [...participants, userId],
      updatedAt: serverTimestamp(),
    });
  }
  
  // Create or get existing call for this link
  // If creator is already in a call, join that call
  // Otherwise, create a new call with creator as receiver (they'll be notified)
  const existingCallId = linkData.activeCallId;
  
  if (existingCallId && userId !== linkData.creatorId) {
    // Join existing call
    return existingCallId;
  } else {
    // Create new call
    const callId = await initiateCall({
      callerId: userId === linkData.creatorId ? userId : linkData.creatorId,
      calleeId: userId === linkData.creatorId ? linkData.creatorId : userId,
      callType: linkData.type === 'video' ? 'video' : 'audio',
    });
    
    // Update link with active call ID
    await updateDoc(linkRef, {
      activeCallId: callId,
      updatedAt: serverTimestamp(),
    });
    
    return callId;
  }
};

