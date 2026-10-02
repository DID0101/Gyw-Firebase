import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'callSession:v1';

const INCOMING_DEBOUNCE_MS = 2500;

type State = {
  /** Call screen currently mounted for this id (any phase). Used for busy detection. */
  activeSessionCallId: string | null;
  /** Dedupe rapid double-fires from Firestore snapshot (same callId). */
  lastIncomingNavigationAt: Record<string, number>;
  /** Set on incoming video accept; consumed when the active call screen starts WebRTC. */
  pendingAnswerWithCamera: boolean;
  setActiveSessionCallId: (callId: string | null) => void;
  setPendingAnswerWithCamera: (withCamera: boolean) => void;
  clearPendingAnswerWithCamera: () => void;
  /** Returns false if this callId was navigated to very recently (duplicate incoming). */
  shouldNavigateToIncomingCall: (callId: string) => boolean;
  reset: () => Promise<void>;
};

export const useCallSessionStore = create<State>((set, get) => ({
  activeSessionCallId: null,
  lastIncomingNavigationAt: {},
  pendingAnswerWithCamera: true,

  setActiveSessionCallId: (callId) => set({ activeSessionCallId: callId }),

  setPendingAnswerWithCamera: (withCamera) =>
    set({ pendingAnswerWithCamera: withCamera }),

  clearPendingAnswerWithCamera: () => set({ pendingAnswerWithCamera: true }),

  shouldNavigateToIncomingCall: (callId) => {
    const now = Date.now();
    const last = get().lastIncomingNavigationAt[callId] ?? 0;
    if (now - last < INCOMING_DEBOUNCE_MS) return false;
    set((s) => ({
      lastIncomingNavigationAt: { ...s.lastIncomingNavigationAt, [callId]: now },
    }));
    return true;
  },

  reset: async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    set({
      activeSessionCallId: null,
      lastIncomingNavigationAt: {},
      pendingAnswerWithCamera: true,
    });
  },
}));
