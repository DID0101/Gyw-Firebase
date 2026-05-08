/**
 * callManagerStore.ts
 *
 * Zustand store that holds live call state consumed by CallService,
 * NotificationService, and the useCallManager hook.
 *
 * Kept in /store (not co-located with the hook) so that non-React code
 * (CallService event callbacks, NotificationService push handlers) can
 * call store.getState() without violating the rules of hooks.
 */
import { create } from 'zustand';

// ── Shared types ──────────────────────────────────────────────────────────────

/** Information received with an incoming-call push / Firestore event. */
export interface IncomingCallInfo {
  callId:        string;
  callerId:      string;
  callerName:    string;
  callerAvatar?: string;
  callType:      'audio' | 'video';
}

/** Information about an outgoing call the local user initiated. */
export interface OutgoingCallInfo {
  callId:         string;
  calleeId:       string;
  calleeName:     string;
  calleeAvatar?:  string;
  callType:       'audio' | 'video';
}

/**
 * Lifecycle status of the managed call.
 *
 * idle             — no call in progress
 * ringing_incoming — incoming call is displayed / ringing
 * ringing_outgoing — outgoing call placed, waiting for answer
 * connecting       — transitioning from ringing to media setup
 * active           — both parties connected
 * ended            — call finished; cleared to idle on next call
 */
export type CallManagerStatus =
  | 'idle'
  | 'ringing_incoming'
  | 'ringing_outgoing'
  | 'connecting'
  | 'active'
  | 'ended';

// ── Store interface ───────────────────────────────────────────────────────────

interface CallManagerState {
  incomingCall:    IncomingCallInfo | null;
  outgoingCall:    OutgoingCallInfo | null;
  callStatus:      CallManagerStatus;
  /** Set when CallKit / Telecom fires the "answer" event. Used by useCallManager. */
  answeredCallId:  string | null;

  // ── Setters ─────────────────────────────────────────────────────────────────
  setIncomingCall: (call: IncomingCallInfo | null) => void;
  setOutgoingCall: (call: OutgoingCallInfo | null) => void;
  setCallStatus:   (status: CallManagerStatus) => void;
  clearCall:       () => void;

  // ── Internal callbacks invoked by CallService ────────────────────────────────
  /** Called when the OS (CallKit / Telecom) reports the call was answered. */
  onCallAnswered:  (callId: string) => void;
  /** Called when the OS reports the call ended / was dismissed. */
  onCallEnded:     (callId: string) => void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useCallManagerStore = create<CallManagerState>((set, get) => ({
  incomingCall:   null,
  outgoingCall:   null,
  callStatus:     'idle',
  answeredCallId: null,

  setIncomingCall: (call) =>
    set({
      incomingCall: call,
      callStatus:   call ? 'ringing_incoming' : 'idle',
    }),

  setOutgoingCall: (call) =>
    set({
      outgoingCall: call,
      callStatus:   call ? 'ringing_outgoing' : 'idle',
    }),

  setCallStatus: (status) => set({ callStatus: status }),

  clearCall: () =>
    set({
      incomingCall:   null,
      outgoingCall:   null,
      callStatus:     'idle',
      answeredCallId: null,
    }),

  onCallAnswered: (callId) => {
    const { incomingCall, outgoingCall } = get();
    const relevant =
      incomingCall?.callId === callId || outgoingCall?.callId === callId;
    if (relevant) {
      set({ callStatus: 'active', answeredCallId: callId });
    }
  },

  onCallEnded: (callId) => {
    const { incomingCall, outgoingCall } = get();
    const relevant =
      incomingCall?.callId === callId || outgoingCall?.callId === callId;
    if (relevant) {
      set({
        incomingCall:   null,
        outgoingCall:   null,
        callStatus:     'ended',
        answeredCallId: null,
      });
    }
  },
}));
