import AsyncStorage from '@react-native-async-storage/async-storage';
import { Chat, ChatMessage } from '@/lib/types/chat';
import { Call } from '@/lib/types/call';
import { Story } from '@/lib/services/storyService';

// Use AsyncStorage for persistence (works perfectly with Expo)
const storage = AsyncStorage;

// Keys for storage
const KEYS = {
  CHATS: 'chats',
  MESSAGES: 'messages',
  CALLS: 'calls',
  STORIES: 'stories',
  LAST_SYNC: 'lastSync',
} as const;

const CHATS_SAVE_DEBOUNCE_MS = 900;
const MESSAGES_SAVE_DEBOUNCE_MS = 750;

let chatsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let chatsSavePending: Chat[] | null = null;

const messageSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const messageSavePending = new Map<string, ChatMessage[]>();

export function cancelDebouncedPersistence(): void {
  if (chatsSaveTimer != null) {
    clearTimeout(chatsSaveTimer);
    chatsSaveTimer = null;
  }
  chatsSavePending = null;
  messageSaveTimers.forEach((timer) => clearTimeout(timer));
  messageSaveTimers.clear();
  messageSavePending.clear();
}

/**
 * Persistence layer for Zustand stores
 * Saves data to MMKV for instant loading on app restart
 */
export const persistence = {
  // Save chats to AsyncStorage
  saveChats: async (chats: Chat[]) => {
    try {
      await storage.setItem(KEYS.CHATS, JSON.stringify(chats));
    } catch (error) {
      if (__DEV__) console.error('Error saving chats to AsyncStorage:', error);
    }
  },
  
  // Load chats from AsyncStorage
  loadChats: async (): Promise<Chat[]> => {
    try {
      const data = await storage.getItem(KEYS.CHATS);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading chats from AsyncStorage:', error);
    }
    return [];
  },
  
  // Save messages to AsyncStorage (by chatId)
  saveMessages: async (chatId: string, messages: ChatMessage[]) => {
    try {
      const allMessages = await persistence.loadAllMessages();
      allMessages[chatId] = messages;
      await storage.setItem(KEYS.MESSAGES, JSON.stringify(allMessages));
    } catch (error) {
      if (__DEV__) console.error('Error saving messages to AsyncStorage:', error);
    }
  },
  
  // Load all messages from AsyncStorage
  loadAllMessages: async (): Promise<Record<string, ChatMessage[]>> => {
    try {
      const data = await storage.getItem(KEYS.MESSAGES);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading messages from AsyncStorage:', error);
    }
    return {};
  },
  
  // Load messages for a specific chat
  loadMessages: async (chatId: string): Promise<ChatMessage[]> => {
    const allMessages = await persistence.loadAllMessages();
    return allMessages[chatId] || [];
  },
  
  // Save calls to AsyncStorage
  saveCalls: async (calls: Call[]) => {
    try {
      await storage.setItem(KEYS.CALLS, JSON.stringify(calls));
    } catch (error) {
      if (__DEV__) console.error('Error saving calls to AsyncStorage:', error);
    }
  },
  
  // Load calls from AsyncStorage
  loadCalls: async (): Promise<Call[]> => {
    try {
      const data = await storage.getItem(KEYS.CALLS);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading calls from AsyncStorage:', error);
    }
    return [];
  },
  
  // Save stories to AsyncStorage
  saveStories: async (stories: Story[]) => {
    try {
      await storage.setItem(KEYS.STORIES, JSON.stringify(stories));
    } catch (error) {
      if (__DEV__) console.error('Error saving stories to AsyncStorage:', error);
    }
  },
  
  // Load stories from AsyncStorage
  loadStories: async (): Promise<Story[]> => {
    try {
      const data = await storage.getItem(KEYS.STORIES);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading stories from AsyncStorage:', error);
    }
    return [];
  },
  
  // Save last sync timestamp
  saveLastSync: async (timestamp: number) => {
    try {
      await storage.setItem(KEYS.LAST_SYNC, timestamp.toString());
    } catch (error) {
      if (__DEV__) console.error('Error saving last sync:', error);
    }
  },
  
  // Load last sync timestamp
  loadLastSync: async (): Promise<number> => {
    try {
      const data = await storage.getItem(KEYS.LAST_SYNC);
      return data ? parseInt(data, 10) : 0;
    } catch (error) {
      if (__DEV__) console.error('Error loading last sync:', error);
      return 0;
    }
  },
  
  // Clear all persisted data
  clearAll: async () => {
    try {
      cancelDebouncedPersistence();
      await storage.multiRemove([KEYS.CHATS, KEYS.MESSAGES, KEYS.CALLS, KEYS.STORIES, KEYS.LAST_SYNC]);
    } catch (error) {
      if (__DEV__) console.error('Error clearing AsyncStorage:', error);
    }
  },
};

/** Coalesce rapid Firestore updates into occasional AsyncStorage writes. */
export function queueSaveChats(chats: Chat[]): void {
  chatsSavePending = chats;
  if (chatsSaveTimer != null) return;
  chatsSaveTimer = setTimeout(() => {
    chatsSaveTimer = null;
    const snap = chatsSavePending;
    chatsSavePending = null;
    if (snap) void persistence.saveChats(snap);
  }, CHATS_SAVE_DEBOUNCE_MS);
}

export function queueSaveMessages(chatId: string, messages: ChatMessage[]): void {
  messageSavePending.set(chatId, messages);
  if (messageSaveTimers.has(chatId)) return;
  const t = setTimeout(() => {
    messageSaveTimers.delete(chatId);
    const latest = messageSavePending.get(chatId);
    messageSavePending.delete(chatId);
    if (latest) void persistence.saveMessages(chatId, latest);
  }, MESSAGES_SAVE_DEBOUNCE_MS);
  messageSaveTimers.set(chatId, t);
}

