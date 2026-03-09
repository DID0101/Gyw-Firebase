import { collection, query, orderBy, limit, getDocs, onSnapshot } from 'firebase/firestore';
import { InteractionManager, Platform } from 'react-native';
import { db } from '@/lib/firebase';
import { getChatMessagesNative, hasNativeFirestore, subscribeToChatMessagesNative } from '@/lib/firestoreNative';
import { ChatMessage } from '@/lib/types/chat';
import { useChatStore } from '@/store/chatStore';

// Only ONE active listener at a time (current chat)
let activeChatListener: (() => void) | null = null;
let currentChatId: string | null = null;

/**
 * Warms up a chat when user shows intent (onPressIn)
 * Only loads if not already in store
 * Non-blocking, happens ~150ms before navigation
 */
export const warmChat = async (chatId: string, messageLimit: number = 20) => {
  (async () => {
    try {
      const existingMessages = useChatStore.getState().messagesByChat[chatId];
      if (existingMessages && existingMessages.length > 0) return;

      let messagesData: ChatMessage[];
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        messagesData = await getChatMessagesNative(chatId, messageLimit) as ChatMessage[];
      } else {
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const messagesQuery = query(
          messagesRef,
          orderBy('createdAt', 'desc'),
          limit(messageLimit)
        );
        const messagesSnapshot = await getDocs(messagesQuery);
        messagesData = [];
        messagesSnapshot.forEach((doc) => {
          const data = doc.data();
          messagesData.push({
            id: doc.id,
            chatId,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
            sentAt: data.sentAt?.toDate?.()?.toISOString() || data.sentAt,
            deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || data.deliveredAt,
            seenAt: data.seenAt?.toDate?.()?.toISOString() || data.seenAt,
            edited: data.edited || false,
            editedAt: data.editedAt?.toDate?.()?.toISOString() || data.editedAt,
            deleted: data.deleted || false,
            deletedFor: data.deletedFor || [],
          } as ChatMessage);
        });
      }
      useChatStore.getState().setMessages(chatId, messagesData, false);
    } catch (error) {
      if (__DEV__) console.error(`Error warming chat ${chatId}:`, error);
    }
  })();
};

/**
 * Starts a Firestore listener for a chat's messages
 * ONLY ONE listener active at a time (current chat)
 * Updates store silently in background
 */
export const startChatMessageListener = (chatId: string, pageSize: number = 50) => {
  if (currentChatId === chatId && activeChatListener) return;

  if (activeChatListener) {
    activeChatListener();
    activeChatListener = null;
    currentChatId = null;
  }

  const applyMessages = (messagesData: ChatMessage[]) => {
    InteractionManager.runAfterInteractions(() => {
      const state = useChatStore.getState();
      const existing = state.messagesByChat[chatId] || [];
      const pending = existing.filter(m => m.status === 'pending');
      const serverIds = new Set(messagesData.map(m => m.id));
      const merged = [...messagesData];
      for (const p of pending) {
        if (!serverIds.has(p.id)) merged.push(p);
      }
      merged.sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return tb - ta;
      });
      state.setMessages(chatId, merged, false);
    });
  };

  let unsubscribe: () => void;
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    unsubscribe = subscribeToChatMessagesNative(
      chatId,
      pageSize,
      applyMessages,
      (error) => {
        if (__DEV__) console.error(`Error in message listener for chat ${chatId}:`, error);
      }
    );
  } else {
    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      limit(pageSize)
    );
    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messagesData: ChatMessage[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          messagesData.push({
            id: doc.id,
            chatId,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
            sentAt: data.sentAt?.toDate?.()?.toISOString() || data.sentAt,
            deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || data.deliveredAt,
            seenAt: data.seenAt?.toDate?.()?.toISOString() || data.seenAt,
            edited: data.edited || false,
            editedAt: data.editedAt?.toDate?.()?.toISOString() || data.editedAt,
            deleted: data.deleted || false,
            deletedFor: data.deletedFor || [],
          } as ChatMessage);
        });
        applyMessages(messagesData);
      },
      (error) => {
        if (__DEV__) console.error(`Error in message listener for chat ${chatId}:`, error);
      }
    );
  }

  activeChatListener = unsubscribe;
  currentChatId = chatId;

  return () => {
    unsubscribe();
    activeChatListener = null;
    currentChatId = null;
  };
};

/**
 * Stops the active chat message listener
 */
export const stopChatMessageListener = () => {
  if (activeChatListener) {
    activeChatListener();
    activeChatListener = null;
    currentChatId = null;
  }
};


