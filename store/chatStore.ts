import { create } from 'zustand';
import { Chat, ChatMessage } from '@/lib/types/chat';
import { persistence, queueSaveChats, queueSaveMessages } from './persistence';

/** Stable empty array for selectors - prevents "getSnapshot should be cached" / infinite loop when chat has no messages */
export const EMPTY_MESSAGES: ChatMessage[] = [];

/** List row–relevant fields only (ignores typing map churn on the same doc). */
function chatsConversationFingerprint(chats: Chat[]): string {
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
  
  // Chats cache
  chats: Chat[];
  
  // Last message timestamps for sorting
  lastMessageTimestamps: Record<string, number>;
  
  // Actions
  setMessages: (chatId: string, messages: ChatMessage[], persist?: boolean) => void;
  addMessage: (chatId: string, message: ChatMessage) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  setChats: (chats: Chat[]) => void;
  updateChat: (chatId: string, updates: Partial<Chat>) => void;
  /** Single store update: set unread to 0 for user on many chats (optimistic mark-all-read). */
  bulkResetUnreadForUser: (userId: string, chatIds: string[]) => void;
  clearChat: (chatId: string) => void;
  clearAll: () => void;
  // Persistence
  loadFromStorage: () => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messagesByChat: {},
  chats: [],
  lastMessageTimestamps: {},
  
  setMessages: (chatId, messages, persist = true) => {
    set((state) => {
      const existing = state.messagesByChat[chatId] || [];
      // Five O(1) checks cover: new/deleted messages, re-ordering, newest message
      // status change (sent→delivered→seen), and read-receipt accumulation.
      // This replaces two O(n) string-building passes that ran on every Firestore update.
      let messagesChanged =
        existing.length !== messages.length ||
        existing[0]?.id !== messages[0]?.id ||
        existing[existing.length - 1]?.id !== messages[messages.length - 1]?.id ||
        existing[0]?.status !== messages[0]?.status ||
        (existing[0]?.readBy?.length ?? 0) !== (messages[0]?.readBy?.length ?? 0);

      // Mid-list edits/deletes/tombstones don't move head/tail — catch them with a capped signature.
      if (!messagesChanged && messagesVisualSignature(existing) !== messagesVisualSignature(messages)) {
        messagesChanged = true;
      }

      if (!messagesChanged) {
        return state;
      }

      if (persist) {
        queueSaveMessages(chatId, messages);
      }

      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: messages,
        },
      };
    });
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
    set((state) => {
      const { [chatId]: removed, ...messagesByChat } = state.messagesByChat;
      const { [chatId]: removedTimestamp, ...lastMessageTimestamps } = state.lastMessageTimestamps;
      
      return {
        messagesByChat,
        lastMessageTimestamps,
      };
    });
  },
  
  clearAll: () => {
    set({
      messagesByChat: {},
      chats: [],
      lastMessageTimestamps: {},
    });
  },
  
  // Load data from AsyncStorage
  loadFromStorage: async () => {
    try {
      const chats = await persistence.loadChats();
      const allMessages = await persistence.loadAllMessages();
      
      set({
        chats,
        messagesByChat: allMessages,
      });
    } catch (error) {
      if (__DEV__) console.error('Error loading from storage:', error);
    }
  },
}));

