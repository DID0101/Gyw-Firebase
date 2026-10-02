/**
 * callManagerStore.ts
 *
 * UI/session state for the active call. Firestore `calls/{callId}` is authoritative;
 * this store holds the mirrored doc and lightweight UI flags (outgoing vs incoming).
 */
import { create } from 'zustand';

import type { Call } from '@/lib/types/call';

export interface IncomingCallInfo {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  callType: 'audio' | 'video';
}

export interface OutgoingCallInfo {
  callId: string;
  calleeId: string;
  calleeName: string;
  calleeAvatar?: string;
  callType: 'audio' | 'video';
}

export type CallManagerStatus =
  | 'idle'
  | 'ringing_incoming'
  | 'ringing_outgoing'
  | 'connecting'
  | 'active'
  | 'ended';

interface CallManagerState {
  /** Single active call id — Firestore listener target in useCallManager. */
  activeCallId: string | null;
  incomingCall: IncomingCallInfo | null;
  outgoingCall: OutgoingCallInfo | null;
  callStatus: CallManagerStatus;
  answeredCallId: string | null;

  setActiveCallId: (callId: string | null) => void;
  syncFromCallDoc: (call: Call, selfUid: string) => void;
  setIncomingCall: (call: IncomingCallInfo | null) => void;
  setOutgoingCall: (call: OutgoingCallInfo | null) => void;
  setCallStatus: (status: CallManagerStatus) => void;
  markCalleeAnswered: (callId: string) => void;
  clearCall: () => void;
  reset: () => void;
  onCallAnswered: (callId: string) => void;
  onCallEnded: (callId: string) => void;
}

function mapCallToIncoming(call: Call): IncomingCallInfo {
  return {
    callId: call.id,
    callerId: call.callerId,
    callerName: call.callerName ?? 'Incoming call',
    callerAvatar: call.callerAvatar,
    callType: call.type === 'video' ? 'video' : 'audio',
  };
}

function mapCallToOutgoing(call: Call, selfUid: string): OutgoingCallInfo {
  const peerId = call.callerId === selfUid ? call.receiverId : call.callerId;
  return {
    callId: call.id,
    calleeId: peerId,
    calleeName: call.callerName ?? 'Contact',
    calleeAvatar: call.callerAvatar,
    callType: call.type === 'video' ? 'video' : 'audio',
  };
}

export const useCallManagerStore = create<CallManagerState>((set, get) => ({
  activeCallId: null,
  incomingCall: null,
  outgoingCall: null,
  callStatus: 'idle',
  answeredCallId: null,

  setActiveCallId: (callId) => set({ activeCallId: callId }),

  syncFromCallDoc: (call, selfUid) => {
    const isCallee = call.receiverId === selfUid || (call as Call & { calleeId?: string }).calleeId === selfUid;
    const isCaller = call.callerId === selfUid;

    if (call.status === 'ringing') {
      const cur = get().callStatus;
      if (
        ['connecting', 'active'].includes(cur) ||
        get().answeredCallId === call.id
      ) {
        if (__DEV__) {
          console.warn('[CALL] syncFromCallDoc: skip ringing — already past ringing', {
            callId: call.id,
            cur,
          });
        }
        return;
      }
      if (isCallee) {
        set({
          activeCallId: call.id,
          incomingCall: mapCallToIncoming(call),
          outgoingCall: null,
          callStatus: 'ringing_incoming',
        });
      } else if (isCaller) {
        set({
          activeCallId: call.id,
          outgoingCall: mapCallToOutgoing(call, selfUid),
          incomingCall: null,
          callStatus: 'ringing_outgoing',
        });
      }
      return;
    }

    if (['accepted', 'answered', 'connecting', 'active'].includes(call.status)) {
      const mgrStatus =
        call.status === 'active' ? 'active' : call.status === 'answered' ? 'connecting' : call.status === 'accepted' ? 'connecting' : 'connecting';
      set({
        activeCallId: call.id,
        callStatus: mgrStatus,
        answeredCallId: call.id,
      });
      return;
    }

    const terminal = ['ended', 'missed', 'declined', 'rejected', 'busy', 'canceled', 'timeout'];
    if (terminal.includes(call.status)) {
      set({
        activeCallId: null,
        incomingCall: null,
        outgoingCall: null,
        callStatus: 'ended',
        answeredCallId: null,
      });
    }
  },

  setIncomingCall: (call) =>
    set({
      incomingCall: call,
      activeCallId: call?.callId ?? get().activeCallId,
      callStatus: call ? 'ringing_incoming' : 'idle',
    }),

  setOutgoingCall: (call) =>
    set({
      outgoingCall: call,
      activeCallId: call?.callId ?? get().activeCallId,
      callStatus: call ? 'ringing_outgoing' : 'idle',
    }),

  setCallStatus: (status) => set({ callStatus: status }),

  /** Callee pressed accept — block ringing UI until terminal. */
  markCalleeAnswered: (callId) =>
    set({
      answeredCallId: callId,
      callStatus: 'connecting',
      incomingCall: null,
    }),

  clearCall: () =>
    set({
      incomingCall: null,
      outgoingCall: null,
      callStatus: 'idle',
      answeredCallId: null,
    }),

  reset: () =>
    set({
      activeCallId: null,
      incomingCall: null,
      outgoingCall: null,
      callStatus: 'idle',
      answeredCallId: null,
    }),

  onCallAnswered: (callId) => {
    const { incomingCall, outgoingCall } = get();
    if (incomingCall?.callId === callId || outgoingCall?.callId === callId) {
      set({ callStatus: 'active', answeredCallId: callId });
    }
  },

  onCallEnded: (callId) => {
    const { incomingCall, outgoingCall } = get();
    if (incomingCall?.callId === callId || outgoingCall?.callId === callId) {
      set({
        incomingCall: null,
        outgoingCall: null,
        callStatus: 'ended',
        answeredCallId: null,
      });
    }
  },
}));
