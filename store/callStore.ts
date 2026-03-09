import { create } from 'zustand';
import { Call } from '@/lib/types/call';
import { persistence } from './persistence';

interface CallStore {
  // Calls cache
  calls: Call[];
  
  // Last update timestamp
  lastUpdated: number;
  
  // Actions
  setCalls: (calls: Call[]) => void;
  addCall: (call: Call) => void;
  updateCall: (callId: string, updates: Partial<Call>) => void;
  clearAll: () => void;
  // Persistence
  loadFromStorage: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  calls: [],
  lastUpdated: 0,
  
  setCalls: (calls) => {
    set((state) => {
      // Only update if calls actually changed
      const callsChanged = 
        state.calls.length !== calls.length ||
        state.calls.some((call, idx) => call.id !== calls[idx]?.id);
      
      if (!callsChanged) {
        return state;
      }
      
      // Persist to AsyncStorage (async, don't block)
      persistence.saveCalls(calls).catch(() => {});
      
      return {
        calls,
        lastUpdated: Date.now(),
      };
    });
  },
  
  addCall: (call) => {
    set((state) => {
      // Check if call already exists
      if (state.calls.some(c => c.id === call.id)) {
        return state;
      }
      
      // Add to beginning (newest first)
      return {
        calls: [call, ...state.calls],
        lastUpdated: Date.now(),
      };
    });
  },
  
  updateCall: (callId, updates) => {
    set((state) => {
      const index = state.calls.findIndex(c => c.id === callId);
      
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
      calls: [],
      lastUpdated: 0,
    });
  },
  
  // Load data from AsyncStorage
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

