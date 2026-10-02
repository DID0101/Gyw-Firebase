import type { User } from '@/lib/types/chat';
import { create } from 'zustand';

interface UserProfileStore {
  byId: Record<string, User>;
  mergeProfiles: (users: Record<string, User>) => void;
  clearAll: () => void;
}

export const useUserProfileStore = create<UserProfileStore>((set) => ({
  byId: {},
  mergeProfiles: (users) => {
    if (Object.keys(users).length === 0) return;
    set((state) => {
      const next = { ...state.byId };
      let changed = false;
      for (const [uid, user] of Object.entries(users)) {
        const prev = next[uid];
        if (
          !prev ||
          prev.displayName !== user.displayName ||
          prev.firstName !== user.firstName ||
          prev.lastName !== user.lastName ||
          prev.avatar !== user.avatar ||
          prev.phoneNumber !== user.phoneNumber ||
          prev.lastActive !== user.lastActive
        ) {
          next[uid] = user;
          changed = true;
        }
      }
      return changed ? { byId: next } : state;
    });
  },
  clearAll: () => set({ byId: {} }),
}));
