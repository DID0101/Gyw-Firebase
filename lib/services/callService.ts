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
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { functions, httpsCallable } from '@/lib/firebase';
import {
  createCallNative,
  getCallHistoryNative,
  getCallNative,
  hasNativeFirestore,
  sendSignalingMessageNative,
  subscribeToCallNative,
  subscribeToSignalingNative,
  updateCallReceiverReadyNative,
  updateCallStatusNative,
} from '@/lib/firestoreNative';
import { Call, CallSignaling } from '@/lib/types/call';

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
  'timeout',
]);

const normalizeCallStatus = (status: string | undefined): Call['status'] => {
  if (!status) return 'ringing';
  if (status === 'answered') return 'accepted' as Call['status'];
  if (status === 'rejected') return 'declined' as Call['status'];
  return status as Call['status'];
};

// Create a new call
export const createCall = async (
  callerId: string,
  receiverId: string,
  type: 'audio' | 'video',
  chatId?: string,
  options?: CreateCallOptions,
  /** Caller's display name — stored in the call doc so the receiver's
   *  CallKeep / lock-screen notification can show the name without a
   *  separate Firestore lookup. */
  callerName?: string,
  callerAvatar?: string,
): Promise<string> => {
  // Defensive: some UI surfaces may pass an untyped value (e.g. old call history rows).
  // Keep the backend contract strict: only 'audio'|'video'.
  const normalizedType: 'audio' | 'video' = type === 'video' ? 'video' : 'audio';
  const opts = options ?? (chatId !== undefined ? { chatId } : {});
  const roomId = doc(collection(db, 'calls')).id;

  // Canonical production path: callable writes call doc + pushes.
  // Keep random path on direct Firestore because it uses a separate flow.
  if (!opts.isRandom) {
    try {
      const initiateCallFn = httpsCallable<any, { success: boolean; roomId: string }>(functions, 'initiateCall');
      const res = await initiateCallFn({
        callerId,
        calleeId: receiverId,
        roomId,
        callType: normalizedType,
        callerName: callerName ?? '',
        callerAvatar: callerAvatar ?? '',
      });
      if (res?.data?.success && res.data.roomId) {
        csLog('Call created (callable):', { roomId: res.data.roomId, callerId, receiverId, type });
        return res.data.roomId;
      }
    } catch (err) {
      csWarn('[callService] initiateCall callable failed, falling back to direct write', err);
    }
  }

  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const callId = await createCallNative(
      callerId,
      receiverId,
      normalizedType,
      opts.chatId,
      opts.isRandom,
      callerName,
      callerAvatar,
    );
    csLog('Call created (native):', { callId, callerId, receiverId, type, chatId: opts.chatId, isRandom: opts.isRandom, status: 'ringing' });
    return callId;
  }

  const callsRef = collection(db, 'calls');
  const callData: any = {
    callerId,
    receiverId,
    calleeId: receiverId, // mirrors receiverId so _layout.tsx Firestore listener (queries calleeId) fires
    type: normalizedType,
    status: 'ringing' as const,
    createdAt: serverTimestamp(),
  };

  if (opts.chatId) callData.chatId = opts.chatId;
  if (opts.isRandom) callData.isRandom = true;
  if (callerName) callData.callerName = callerName;
  if (callerAvatar) callData.callerAvatar = callerAvatar;

  const callDocRef = doc(callsRef);
  await setDoc(callDocRef, callData);

  csLog('Call created:', {
    callId: callDocRef.id,
    callerId,
    receiverId,
    type,
    chatId: opts.chatId,
    isRandom: opts.isRandom,
    status: 'ringing',
  });

  return callDocRef.id;
};

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
  try {
    const transitionFn = httpsCallable<any, { success: true; status: string }>(functions, 'transitionCallState');
    await transitionFn({
      roomId: callId,
      nextStatus: normalizedStatus,
      ...(typeof duration === 'number' ? { duration } : {}),
    });
    return;
  } catch (err) {
    if (__DEV__) console.warn('[callService] transitionCallState callable failed, fallback to direct update', err);
  }

  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await updateCallStatusNative(callId, normalizedStatus, duration, chatId);
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
      console.error('Error listening to call:', error);
      callback(null);
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
  candidate?: RTCIceCandidateInit
): Promise<void> => {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      await sendSignalingMessageNative(callId, from, to, type, sdp, candidate);
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
      timestamp: serverTimestamp(),
    });
    csLog(`Signaling ${type} sent from ${from} to ${to}`);
  } catch (error) {
    console.error(`Error sending signaling ${type}:`, error);
    throw error;
  }
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

  return onSnapshot(
    q,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
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

// Get user's call history
export const getCallHistory = async (userId: string, limitCount: number = 50): Promise<Call[]> => {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return getCallHistoryNative(userId, limitCount) as Promise<Call[]>;
  }

  const callsRef = collection(db, 'calls');
  
  // Get calls where user is caller (without orderBy to avoid index requirement)
  const callerQ = query(
    callsRef,
    where('callerId', '==', userId)
  );

  const callerSnapshot = await getDocs(callerQ);
  const calls: Call[] = [];

  callerSnapshot.forEach((doc) => {
    const data = doc.data();
    calls.push({
      id: doc.id,
      ...data,
      direction: 'outgoing' as const,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      endedAt: data.endedAt?.toDate?.()?.toISOString() || data.endedAt,
    } as Call);
  });

  // Also get calls where user is receiver (without orderBy to avoid index requirement)
  const receiverQ = query(
    callsRef,
    where('receiverId', '==', userId)
  );

  const receiverSnapshot = await getDocs(receiverQ);
  receiverSnapshot.forEach((doc) => {
    const data = doc.data();
    calls.push({
      id: doc.id,
      ...data,
      direction: 'incoming' as const,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      endedAt: data.endedAt?.toDate?.()?.toISOString() || data.endedAt,
    } as Call);
  });

  // Sort by createdAt descending (in memory to avoid Firestore index requirement)
  calls.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA;
  });

  // Return only completed terminal calls (exclude active/ringing and random)
  const completedCalls = calls.filter(
    (call) =>
      ['ended', 'missed', 'declined', 'rejected', 'canceled', 'timeout'].includes(call.status) && !call.isRandom
  );

  return completedCalls.slice(0, limitCount);
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
  const callLinksRef = collection(db, 'callLinks');
  
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
    const callId = await createCall(
      userId === linkData.creatorId ? userId : linkData.creatorId,
      userId === linkData.creatorId ? linkData.creatorId : userId,
      linkData.type
    );
    
    // Update link with active call ID
    await updateDoc(linkRef, {
      activeCallId: callId,
      updatedAt: serverTimestamp(),
    });
    
    return callId;
  }
};

