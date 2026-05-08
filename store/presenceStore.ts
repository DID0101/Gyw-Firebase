import { create } from 'zustand';

interface PresenceStore {
  onlineUsers: Record<string, boolean>;
  lastActive: Record<string, number>;
  typingUsers: Record<string, { name: string; until: number }>;
  setOnline: (userId: string, isOnline: boolean) => void;
  setLastActive: (userId: string, timestamp: number) => void;
  setTyping: (chatId: string, userId: string, name: string, isTyping: boolean) => void;
  setTypingFromChat: (chatId: string, typingMap: Record<string, any>, participantData: Record<string, any>, currentUserId?: string) => void;
  getTypingNames: (chatId: string, excludeUserId?: string) => string[];
  setMultipleOnline: (users: Record<string, boolean>) => void;
  clearAll: () => void;
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  onlineUsers: {},
  lastActive: {},
  typingUsers: {},
  
  setOnline: (userId, isOnline) => {
    set((state) => {
      // Only update if status changed
      if (state.onlineUsers[userId] === isOnline) {
        return state;
      }
      
      return {
        onlineUsers: {
          ...state.onlineUsers,
          [userId]: isOnline,
        },
      };
    });
  },
  
  setLastActive: (userId, timestamp) => {
    set((state) => {
      // Only update if timestamp changed
      if (state.lastActive[userId] === timestamp) {
        return state;
      }
      
      return {
        lastActive: {
          ...state.lastActive,
          [userId]: timestamp,
        },
      };
    });
  },
  
  setTyping: (chatId, userId, name, isTyping) => {
    const key = `${chatId}:${userId}`;
    set((state) => {
      const typingUsers = { ...state.typingUsers };
      if (isTyping) {
        typingUsers[key] = { name, until: Date.now() + 4000 };
      } else {
        delete typingUsers[key];
      }
      return { typingUsers };
    });
  },
  setTypingFromChat: (chatId, typingMap, participantData, currentUserId) => {
    const now = Date.now();
    set((state) => {
      const typingUsers = { ...state.typingUsers };
      const prefix = chatId + ':';
      Object.keys(typingUsers).filter(k => k.startsWith(prefix)).forEach(k => delete typingUsers[k]);
      Object.entries(typingMap || {}).forEach(([uid, val]: [string, any]) => {
        if (uid === currentUserId) return;
        const at = val?.at?.toDate?.()?.getTime?.() ?? new Date(val?.at || 0).getTime();
        if (now - at < 5000) {
          const name = participantData?.[uid]?.name || 'Someone';
          typingUsers[`${chatId}:${uid}`] = { name, until: now + 4000 };
        }
      });
      return { typingUsers };
    });
  },
  getTypingNames: (chatId, excludeUserId) => {
    const state = get();
    const now = Date.now();
    return Object.entries(state.typingUsers)
      .filter(([k, v]) => k.startsWith(chatId + ':') && v.until > now && (!excludeUserId || !k.endsWith(':' + excludeUserId)))
      .map(([, v]) => v.name);
  },
  setMultipleOnline: (users) => {
    set((state) => {
      // Only update if any value actually changed
      const hasChange = Object.entries(users).some(
        ([id, online]) => state.onlineUsers[id] !== online
      );
      if (!hasChange) return state;
      return {
        onlineUsers: {
          ...state.onlineUsers,
          ...users,
        },
      };
    });
  },
  
  clearAll: () => {
    set({
      onlineUsers: {},
      lastActive: {},
      typingUsers: {},
    });
  },
}));

