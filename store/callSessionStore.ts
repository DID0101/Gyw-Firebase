import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'callSession:v1';

/** Minimal session helper (e.g. clear persisted call UI on sign-out / leave call). */
export const useCallSessionStore = create<{
  reset: () => Promise<void>;
}>(() => ({
  reset: async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  },
}));
