import { resolveCallerDisplayName } from '@/lib/contacts/contactResolver';
import { syncCallerProfileToNative } from '@/lib/contacts/syncCallerProfilesToNative';
import { create } from 'zustand';
import { Call } from '@/lib/types/call';
import { persistence } from './persistence';

/** Payload for the in-app incoming call screen (Zustand mirror of Firestore + route params). */
export type IncomingCallStoreData = {
  callId: string;
  callType: 'audio' | 'video';
  status: string;
  callerId: string;
  callerName: string;
  callerPhone?: string;
  callerAvatar?: string;
  chatId?: string;
  timestamp: number;
};

export function callDocToIncomingStore(call: Call): IncomingCallStoreData {
  const createdMs =
    typeof call.createdAt === 'string' && call.createdAt
      ? new Date(call.createdAt).getTime()
      : Date.now();
  return {
    callId: call.id,
    callType: call.type === 'video' ? 'video' : 'audio',
    status: call.status,
    callerId: call.callerId,
    callerName: resolveCallerDisplayName({
      callerName: call.callerName,
      callerPhone: (call as Call & { callerPhone?: string }).callerPhone,
    }),
    callerPhone: (call as Call & { callerPhone?: string }).callerPhone,
    callerAvatar: call.callerAvatar,
    chatId: call.chatId,
    timestamp: createdMs,
  };
}

interface CallStore {
  /** Live call mirrored from Firestore (authoritative status). */
  activeCall: Call | null;
  /** Dedicated incoming UI payload — set before navigating to /call/incoming. */
  incomingCall: IncomingCallStoreData | null;
  calls: Call[];
  lastUpdated: number;

  setCallData: (call: Call | null) => void;
  setIncomingCall: (data: IncomingCallStoreData | null) => void;
  clearIncomingCall: () => void;
  clearActiveCall: () => void;
  setCalls: (calls: Call[]) => void;
  addCall: (call: Call) => void;
  updateCall: (callId: string, updates: Partial<Call>) => void;
  clearAll: () => void;
  loadFromStorage: () => Promise<void>;
}

export const useCallStore = create<CallStore>((set, get) => ({
  activeCall: null,
  incomingCall: null,
  calls: [],
  lastUpdated: 0,

  setCallData: (call) => {
    set({ activeCall: call });
    if (call && get().incomingCall?.callId === call.id) {
      set({ incomingCall: callDocToIncomingStore(call) });
    }
  },

  setIncomingCall: (data) => {
    set({ incomingCall: data });
    if (data?.callerId && data.callerName) {
      syncCallerProfileToNative(data.callerId, {
        name: data.callerName,
        avatar: data.callerAvatar,
        phone: data.callerPhone,
      });
    }
  },

  clearIncomingCall: () => set({ incomingCall: null }),

  clearActiveCall: () => set({ activeCall: null }),

  setCalls: (calls) => {
    set((state) => {
      const sig = (c: Call[]) =>
        c.map((x) => `${x.id}:${x.status}:${x.duration ?? ''}:${x.endedAt ?? ''}`).join('|');
      if (state.calls.length === calls.length && sig(state.calls) === sig(calls)) {
        return state;
      }

      persistence.saveCalls(calls).catch(() => {});

      return {
        calls,
        lastUpdated: Date.now(),
      };
    });
  },

  addCall: (call) => {
    set((state) => {
      if (state.calls.some((c) => c.id === call.id)) {
        return state;
      }
      return {
        calls: [call, ...state.calls],
        lastUpdated: Date.now(),
      };
    });
  },

  updateCall: (callId, updates) => {
    set((state) => {
      const index = state.calls.findIndex((c) => c.id === callId);
      if (index === -1) {
        return state;
      }
      const updatedCalls = [...state.calls];
      updatedCalls[index] = { ...updatedCalls[index], ...updates };
      return {
        calls: updatedCalls,
        lastUpdated: Date.now(),
      };
    });
  },

  clearAll: () => {
    set({
      activeCall: null,
      incomingCall: null,
      calls: [],
      lastUpdated: 0,
    });
  },

  loadFromStorage: async () => {
    try {
      const calls = await persistence.loadCalls();
      set({
        calls,
        lastUpdated: Date.now(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error loading calls from storage:', error);
    }
  },
}));
