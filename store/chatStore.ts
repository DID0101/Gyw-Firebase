import { create } from 'zustand';
import { Chat, ChatMessage } from '@/lib/types/chat';
import { persistence } from './persistence';

/** Stable empty array for selectors - prevents "getSnapshot should be cached" / infinite loop when chat has no messages */
export const EMPTY_MESSAGES: ChatMessage[] = [];

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
  clearChat: (chatId: string) => void;
  clearAll: () => void;
  // Persistence
  loadFromStorage: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messagesByChat: {},
  chats: [],
  lastMessageTimestamps: {},
  
  setMessages: (chatId, messages, persist = true) => {
    set((state) => {
      // Avoid recreating array if messages haven't changed
      const existing = state.messagesByChat[chatId] || [];
      const messagesChanged = 
        existing.length !== messages.length ||
        existing.some((msg, idx) => msg.id !== messages[idx]?.id);
      
      if (!messagesChanged) {
        return state;
      }
      
      // Only persist if explicitly requested (not on every load)
      if (persist) {
        persistence.saveMessages(chatId, messages).catch(() => {});
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
      
      // Append to existing array without recreating
      const newMessages = [...existing, message];
      
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
      
      const updatedMessages = [...messages];
      updatedMessages[index] = { ...updatedMessages[index], ...updates };
      
      // Deduplicate by id (optimistic temp id replaced with real id)
      const deduped = updatedMessages.filter((m, i) => i === updatedMessages.findIndex(x => x.id === m.id));
      
      return {
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: deduped,
        },
      };
    });
  },
  
  setChats: (chats) => {
    set((state) => {
      // Only update if chats actually changed
      const chatsChanged = 
        state.chats.length !== chats.length ||
        state.chats.some((chat, idx) => chat.id !== chats[idx]?.id);
      
      if (!chatsChanged) {
        return state;
      }
      
      // Persist to AsyncStorage (async, don't block)
      persistence.saveChats(chats).catch(() => {});
      
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

