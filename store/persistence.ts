import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_PERSISTED_MESSAGES_PER_CHAT } from '@/lib/chatMessageLimits';
import { isLegacyAndroid, isLowTierAndroid } from '@/lib/perf/deviceProfile';
import { Platform } from 'react-native';
import { Chat, ChatMessage } from '@/lib/types/chat';
import { Call } from '@/lib/types/call';
import { Story } from '@/lib/services/storyService';

// Use AsyncStorage for persistence (works perfectly with Expo)
const storage = AsyncStorage;

// Keys for storage
const KEYS = {
  CHATS: 'chats',
  MESSAGES: 'messages',
  /** Index of chat ids with per-chat message shards (bounded O(1) writes). */
  MESSAGE_SHARD_INDEX: 'msg_shard_index',
  CALLS: 'calls',
  STORIES: 'stories',
  LAST_SYNC: 'lastSync',
  /** Per-auth-user list of story doc ids the user has watched (ring UX). */
  STORY_VIEWED_IDS: 'storyViewedIds',
} as const;

const MESSAGE_SHARD_PREFIX = 'msg_shard:';
const MESSAGE_SHARD_INDEX_CAP = 48;
/** First N shards loaded synchronously on cold start; rest hydrate in background. */
const STAGED_SHARD_LOAD_FIRST = 12;

function stagedShardLoadCount(): number {
  if (Platform.OS !== 'android') return STAGED_SHARD_LOAD_FIRST;
  if (isLegacyAndroid()) return 4;
  if (isLowTierAndroid()) return 6;
  return STAGED_SHARD_LOAD_FIRST;
}

function messageShardKey(chatId: string): string {
  return `${MESSAGE_SHARD_PREFIX}${chatId}`;
}

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
  
  // Save messages to AsyncStorage (by chatId) — legacy monolithic blob (avoid on hot path).
  saveMessages: async (chatId: string, messages: ChatMessage[]) => {
    try {
      const allMessages = await persistence.loadAllMessages();
      allMessages[chatId] = messages;
      await storage.setItem(KEYS.MESSAGES, JSON.stringify(allMessages));
    } catch (error) {
      if (__DEV__) console.error('Error saving messages to AsyncStorage:', error);
    }
  },

  /** Per-chat shard: last N messages only — no full-blob read/write. */
  saveMessageShard: async (chatId: string, messages: ChatMessage[]) => {
    if (!chatId) return;
    try {
      const bounded = messages.slice(0, MAX_PERSISTED_MESSAGES_PER_CHAT);
      await storage.setItem(messageShardKey(chatId), JSON.stringify(bounded));
      const rawIndex = await storage.getItem(KEYS.MESSAGE_SHARD_INDEX);
      let index: string[] = [];
      if (rawIndex) {
        try {
          const parsed = JSON.parse(rawIndex) as unknown;
          if (Array.isArray(parsed)) index = parsed.filter((id): id is string => typeof id === 'string');
        } catch {
          index = [];
        }
      }
      const next = [chatId, ...index.filter((id) => id !== chatId)].slice(0, MESSAGE_SHARD_INDEX_CAP);
      await storage.setItem(KEYS.MESSAGE_SHARD_INDEX, JSON.stringify(next));
    } catch (error) {
      if (__DEV__) console.error('Error saving message shard:', error);
    }
  },

  loadShardsForChatIds: async (chatIds: string[]): Promise<Record<string, ChatMessage[]>> => {
    if (chatIds.length === 0) return {};
    try {
      const keys = chatIds.map(messageShardKey);
      const pairs = await storage.multiGet(keys);
      const out: Record<string, ChatMessage[]> = {};
      for (let i = 0; i < pairs.length; i++) {
        const [, value] = pairs[i]!;
        const chatId = chatIds[i]!;
        if (!value) continue;
        try {
          const parsed = JSON.parse(value) as unknown;
          if (Array.isArray(parsed)) out[chatId] = parsed as ChatMessage[];
        } catch {
          /* skip corrupt shard */
        }
      }
      return out;
    } catch (error) {
      if (__DEV__) console.error('Error loading message shards for ids:', error);
      return {};
    }
  },

  loadAllMessageShards: async (): Promise<Record<string, ChatMessage[]>> => {
    try {
      const rawIndex = await storage.getItem(KEYS.MESSAGE_SHARD_INDEX);
      if (!rawIndex) return {};
      const index = JSON.parse(rawIndex) as unknown;
      if (!Array.isArray(index)) return {};
      const chatIds = index.filter((id): id is string => typeof id === 'string');
      return persistence.loadShardsForChatIds(chatIds);
    } catch (error) {
      if (__DEV__) console.error('Error loading message shards:', error);
      return {};
    }
  },

  /**
   * Staged cold start: load recent shards first, return remaining chat ids for background hydrate.
   */
  loadMessageShardsStaged: async (): Promise<{
    shards: Record<string, ChatMessage[]>;
    remainingChatIds: string[];
  }> => {
    try {
      const rawIndex = await storage.getItem(KEYS.MESSAGE_SHARD_INDEX);
      if (!rawIndex) return { shards: {}, remainingChatIds: [] };
      const index = JSON.parse(rawIndex) as unknown;
      if (!Array.isArray(index)) return { shards: {}, remainingChatIds: [] };
      const chatIds = index.filter((id): id is string => typeof id === 'string');
      if (chatIds.length === 0) return { shards: {}, remainingChatIds: [] };
      const firstCount = stagedShardLoadCount();
      const first = chatIds.slice(0, firstCount);
      const rest = chatIds.slice(firstCount);
      const shards = await persistence.loadShardsForChatIds(first);
      return { shards, remainingChatIds: rest };
    } catch (error) {
      if (__DEV__) console.error('Error in staged shard load:', error);
      return { shards: {}, remainingChatIds: [] };
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

  /** Map firebase uid -> string[] of story ids marked seen locally (capped per user). */
  loadStoryViewedIdsMap: async (): Promise<Record<string, string[]>> => {
    try {
      const data = await storage.getItem(KEYS.STORY_VIEWED_IDS);
      if (!data) return {};
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string[]>;
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading story viewed ids:', error);
    }
    return {};
  },

  saveStoryViewedIdsForUser: async (uid: string, storyIds: string[]) => {
    try {
      const map = await persistence.loadStoryViewedIdsMap();
      const capped = storyIds.slice(-800);
      map[uid] = capped;
      await storage.setItem(KEYS.STORY_VIEWED_IDS, JSON.stringify(map));
    } catch (error) {
      if (__DEV__) console.error('Error saving story viewed ids:', error);
    }
  },
  
  // Clear all persisted data
  clearAll: async () => {
    try {
      cancelDebouncedPersistence();
      const shardIndexRaw = await storage.getItem(KEYS.MESSAGE_SHARD_INDEX);
      const shardKeys: string[] = [];
      if (shardIndexRaw) {
        try {
          const index = JSON.parse(shardIndexRaw) as unknown;
          if (Array.isArray(index)) {
            for (const id of index) {
              if (typeof id === 'string') shardKeys.push(messageShardKey(id));
            }
          }
        } catch {
          /* ignore */
        }
      }
      await storage.multiRemove([
        KEYS.CHATS,
        KEYS.MESSAGES,
        KEYS.MESSAGE_SHARD_INDEX,
        ...shardKeys,
        KEYS.CALLS,
        KEYS.STORIES,
        KEYS.LAST_SYNC,
        KEYS.STORY_VIEWED_IDS,
      ]);
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
    if (latest) void persistence.saveMessageShard(chatId, latest);
  }, MESSAGES_SAVE_DEBOUNCE_MS);
  messageSaveTimers.set(chatId, t);
}

