import { MAX_IN_MEMORY_MESSAGES_PER_CHAT } from '@/lib/chatMessageLimits';
import { isLegacyAndroid, isLowTierAndroid } from '@/lib/perf/deviceProfile';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { Chat, ChatMessage } from '@/lib/types/chat';
import { persistence, queueSaveChats, queueSaveMessages } from './persistence';

/** Stable empty array for selectors - prevents "getSnapshot should be cached" / infinite loop when chat has no messages */
export const EMPTY_MESSAGES: ChatMessage[] = [];

const chatCacheTouchedAt = new Map<string, number>();

function maxInMemoryCachedChats(): number {
  if (Platform.OS !== 'android') return 12;
  if (isLegacyAndroid()) return 4;
  if (isLowTierAndroid()) return 5;
  return 8;
}

/** Newest-first store order — keep the most recent `cap` rows. */
function capMessagesNewestFirst(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_IN_MEMORY_MESSAGES_PER_CHAT) return messages;
  return messages.slice(0, MAX_IN_MEMORY_MESSAGES_PER_CHAT);
}

function touchChatCache(chatId: string): void {
  chatCacheTouchedAt.set(chatId, Date.now());
}

export type MessagesSource = 'cache' | 'warm' | 'live';

/** List row–relevant fields only (ignores typing map churn on the same doc). */
export function chatsConversationFingerprint(chats: Chat[]): string {
  return chats
    .map((c) => {
      const lm = c.lastMessage;
      const lmSig = lm
        ? `${lm.type ?? ''}\t${lm.senderId ?? ''}\t${(lm.text ?? '').slice(0, 160)}`
        : '';
      const ur = c.unreadCount ? JSON.stringify(c.unreadCount) : '';
      const pc = Array.isArray(c.participants) ? c.participants.length : 0;
      return `${c.id}\t${c.lastMessageAt ?? ''}\t${c.updatedAt ?? ''}\t${ur}\t${lmSig}\t${pc}`;
    })
    .join('\n');
}

/** Detect real message-list changes beyond id sequence (status, read receipts, text). */
function messagesVisualSignature(msgs: ChatMessage[], cap = 80): string {
  const n = msgs.length;
  let s = String(n);
  for (let i = 0; i < Math.min(cap, n); i++) {
    const m = msgs[i]!;
    const rb = m.readBy?.length ? m.readBy!.join(',') : '';
    const tx = (m.text ?? '').slice(0, 48);
    const df = m.deletedFor?.length ?? 0;
    s += `\n${m.id}:${m.status}:${rb}:${tx}:${m.edited ? 1 : 0}:${m.deleted ? 1 : 0}:${df}`;
  }
  return s;
}

interface ChatStore {
  // Messages cache: { chatId: ChatMessage[] }
  messagesByChat: Record<string, ChatMessage[]>;

  /** How messages for a chat were last populated (disk / warm fetch / live listener). */
  messagesSourceByChat: Record<string, MessagesSource>;
  
  // Chats cache
  chats: Chat[];
  
  // Last message timestamps for sorting
  lastMessageTimestamps: Record<string, number>;
  
  // Actions
  setMessages: (chatId: string, messages: ChatMessage[], persist?: boolean) => void;
  setMessagesSource: (chatId: string, source: MessagesSource) => void;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  setChats: (chats: Chat[]) => void;
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
  /** Single store update: set unread to 0 for user on many chats (optimistic mark-all-read). */
  bulkResetUnreadForUser: (userId: string, chatIds: string[]) => void;
  clearChat: (chatId: string) => void;
  clearAll: () => void;
  /** Drop cold message caches on background — keeps a few recently opened chats. */
  trimMemoryFootprint: (keepChatIds?: string[]) => void;
  // Persistence
  loadFromStorage: () => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => {
  const evictMessageCachesIfNeeded = (keepChatIds: Set<string>) => {
    const { messagesByChat } = get();
    const keys = Object.keys(messagesByChat);
    const maxChats = maxInMemoryCachedChats();
    if (keys.length <= maxChats) return;

    const evictable = keys
      .filter((id) => !keepChatIds.has(id))
      .sort((a, b) => (chatCacheTouchedAt.get(a) ?? 0) - (chatCacheTouchedAt.get(b) ?? 0));
    const removeCount = keys.length - maxChats;
    const toRemove = evictable.slice(0, removeCount);
    if (toRemove.length === 0) return;

    set((state) => {
      const nextMessages = { ...state.messagesByChat };
      const nextSources = { ...state.messagesSourceByChat };
      for (const id of toRemove) {
        delete nextMessages[id];
        delete nextSources[id];
        chatCacheTouchedAt.delete(id);
      }
      return { messagesByChat: nextMessages, messagesSourceByChat: nextSources };
    });
  };

  return {
  messagesByChat: {},
  messagesSourceByChat: {},
  chats: [],
  lastMessageTimestamps: {},
  
  setMessagesSource: (chatId, source) => {
    set((state) => {
      if (state.messagesSourceByChat[chatId] === source) return state;
      return {
        messagesSourceByChat: { ...state.messagesSourceByChat, [chatId]: source },
      };
    });
  },

  setMessages: (chatId, messages, persist = true) => {
    touchChatCache(chatId);
    const bounded = capMessagesNewestFirst(messages);
    set((state) => {
      const existing = state.messagesByChat[chatId] || [];
      // Five O(1) checks cover: new/deleted messages, re-ordering, newest message
      // status change (sent→delivered→seen), and read-receipt accumulation.
      // This replaces two O(n) string-building passes that ran on every Firestore update.
      let messagesChanged =
        existing.length !== bounded.length ||
        existing[0]?.id !== bounded[0]?.id ||
        existing[existing.length - 1]?.id !== bounded[bounded.length - 1]?.id ||
        existing[0]?.status !== bounded[0]?.status ||
        (existing[0]?.readBy?.length ?? 0) !== (bounded[0]?.readBy?.length ?? 0);

      // Mid-list edits/deletes/tombstones don't move head/tail — catch them with a capped signature.
      if (!messagesChanged && messagesVisualSignature(existing) !== messagesVisualSignature(bounded)) {
        messagesChanged = true;
      }

      if (!messagesChanged) {
        return state;
      }

      if (persist) {
        queueSaveMessages(chatId, bounded);
      }

      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: bounded,
        },
      };
    });
    evictMessageCachesIfNeeded(new Set([chatId]));
  },
  
  addMessage: (chatId, message) => {
    set((state) => {
      const existing = state.messagesByChat[chatId] || [];

      // Check if message already exists (avoid duplicates)
      if (existing.some(m => m.id === message.id)) {
        return state;
      }

      // Prepend so newest message stays at index 0 (matches newest-first store order
      // from applyMessages, avoids redundant sort in the chat screen useMemo)
      const newMessages = [message, ...existing];

      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: newMessages,
        },
        lastMessageTimestamps: {
          ...state.lastMessageTimestamps,
          [chatId]: new Date(message.createdAt).getTime(),
        },
      };
    });
    evictMessageCachesIfNeeded(new Set([chatId]));
  },

  updateMessage: (chatId, messageId, updates) => {
    set((state) => {
      const messages = state.messagesByChat[chatId] || [];
      const index = messages.findIndex(m => m.id === messageId);

      if (index === -1) return state;

      const updatedMessage = { ...messages[index], ...updates };

      // If the id changed (optimistic temp id → real id), deduplicate using a Map (O(n))
      // instead of the previous O(n²) filter+findIndex pattern.
      if (updates.id && updates.id !== messageId) {
        const dedupedMap = new Map<string, ChatMessage>();
        for (let i = 0; i < messages.length; i++) {
          const m = i === index ? updatedMessage : messages[i];
          dedupedMap.set(m.id, m);
        }
        return {
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: Array.from(dedupedMap.values()),
          },
        };
      }

      // No id change — simple in-place update, no dedup needed
      const updatedMessages = [...messages];
      updatedMessages[index] = updatedMessage;
      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: updatedMessages,
        },
      };
    });
  },
  
  setChats: (chats) => {
    set((state) => {
      if (
        state.chats.length === chats.length &&
        chatsConversationFingerprint(state.chats) === chatsConversationFingerprint(chats)
      ) {
        return state;
      }

      queueSaveChats(chats);

      return { chats };
    });
  },
  
  updateChat: (chatId, updates) => {
    set((state) => {
      const index = state.chats.findIndex(c => c.id === chatId);
      
      if (index === -1) {
        return state;
      }
      
      const updatedChats = [...state.chats];
      updatedChats[index] = { ...updatedChats[index], ...updates };
      
      return { chats: updatedChats };
    });
  },

  bulkResetUnreadForUser: (userId, chatIds) => {
    if (!chatIds.length) return;
    const idSet = new Set(chatIds);
    set((state) => {
      let changed = false;
      const updatedChats = state.chats.map((c) => {
        if (!idSet.has(c.id)) return c;
        const prev = c.unreadCount?.[userId] ?? 0;
        if (prev === 0) return c;
        changed = true;
        return {
          ...c,
          unreadCount: { ...c.unreadCount, [userId]: 0 },
        };
      });
      if (!changed) return state;
      queueSaveChats(updatedChats);
      return { chats: updatedChats };
    });
  },
  
  clearChat: (chatId) => {
    chatCacheTouchedAt.delete(chatId);
    set((state) => {
      const { [chatId]: removed, ...messagesByChat } = state.messagesByChat;
      const { [chatId]: removedTimestamp, ...lastMessageTimestamps } = state.lastMessageTimestamps;
      const { [chatId]: removedSource, ...messagesSourceByChat } = state.messagesSourceByChat;

      return {
        messagesByChat,
        messagesSourceByChat,
        lastMessageTimestamps,
      };
    });
  },

  trimMemoryFootprint: (keepChatIds = []) => {
    const keep = new Set(keepChatIds.filter(Boolean));
    const keepSet =
      keep.size === 0
        ? new Set<string>()
        : new Set(
            [...keep]
              .sort((a, b) => (chatCacheTouchedAt.get(b) ?? 0) - (chatCacheTouchedAt.get(a) ?? 0))
              .slice(0, maxInMemoryCachedChats())
          );

    set((state) => {
      const nextMessages: Record<string, ChatMessage[]> = {};
      const nextSources: Record<string, MessagesSource> = {};
      for (const id of Object.keys(state.messagesByChat)) {
        if (!keepSet.has(id)) {
          chatCacheTouchedAt.delete(id);
          continue;
        }
        nextMessages[id] = capMessagesNewestFirst(state.messagesByChat[id] || []);
        if (state.messagesSourceByChat[id]) {
          nextSources[id] = state.messagesSourceByChat[id]!;
        }
      }
      return { messagesByChat: nextMessages, messagesSourceByChat: nextSources };
    });
  },
  
  clearAll: () => {
    chatCacheTouchedAt.clear();
    set({
      messagesByChat: {},
      messagesSourceByChat: {},
      chats: [],
      lastMessageTimestamps: {},
    });
  },
  
  // Load data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const [chats, legacyMessages] = await Promise.all([
        persistence.loadChats(),
        persistence.loadAllMessages(),
      ]);

      let shards: Record<string, ChatMessage[]> = {};
      if (Platform.OS === 'android') {
        const staged = await persistence.loadMessageShardsStaged();
        shards = staged.shards;
        const remaining = staged.remainingChatIds;
        if (remaining.length > 0) {
          queueMicrotask(() => {
            void persistence.loadShardsForChatIds(remaining).then((restShards) => {
              if (Object.keys(restShards).length === 0) return;
              const state = get();
              const merged = { ...state.messagesByChat, ...restShards };
              const sources = { ...state.messagesSourceByChat };
              for (const id of Object.keys(restShards)) {
                if ((restShards[id]?.length ?? 0) > 0) sources[id] = 'cache';
              }
              set({ messagesByChat: merged, messagesSourceByChat: sources });
            });
          });
        }
      } else {
        shards = await persistence.loadAllMessageShards();
      }

      const messagesByChat = { ...legacyMessages, ...shards };
      const messagesSourceByChat: Record<string, MessagesSource> = {};
      for (const id of Object.keys(messagesByChat)) {
        if ((messagesByChat[id]?.length ?? 0) > 0) {
          messagesSourceByChat[id] = 'cache';
        }
      }

      const cappedByChat: Record<string, ChatMessage[]> = {};
      for (const id of Object.keys(messagesByChat)) {
        cappedByChat[id] = capMessagesNewestFirst(messagesByChat[id] || []);
        touchChatCache(id);
      }

      set({
        chats,
        messagesByChat: cappedByChat,
        messagesSourceByChat,
      });
      evictMessageCachesIfNeeded(new Set(Object.keys(cappedByChat)));
    } catch (error) {
      if (__DEV__) console.error('Error loading from storage:', error);
    }
  },
};
});

