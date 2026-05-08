import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  onSnapshot,
  startAfter,
  doc,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { db } from '@/lib/firebase';
import {
  fetchOlderMessagesAfterNative,
  getChatMessagesNative,
  hasNativeFirestore,
  subscribeToChatMessagesNative,
} from '@/lib/firestoreNative';
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
    // queueMicrotask: apply soon without waiting for navigation transitions
    // (InteractionManager.runAfterInteractions made open/exit feel sluggish).
    queueMicrotask(() => {
      const state = useChatStore.getState();
      const existing = state.messagesByChat[chatId] || [];
      const pending = existing.filter(m => m.status === 'pending');
      const byId = new Map<string, ChatMessage>();
      for (const m of existing) {
        byId.set(m.id, m);
      }
      for (const m of messagesData) {
        byId.set(m.id, m);
      }
      for (const p of pending) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
      // Firestore snapshot can arrive before updateMessage() re-keys the optimistic row:
      // same send appears as both `pending-*` and the real doc id → duplicate bubbles / duplicate keys.
      for (const sm of messagesData) {
        if (!sm?.id || sm.id.startsWith('pending-') || sm.id.startsWith('ai-pending-')) continue;
        if (sm.type !== 'text') continue;
        const sText = String(sm.text ?? '').trim();
        if (!sText || !sm.senderId) continue;
        for (const [id, m] of byId.entries()) {
          if (!id.startsWith('pending-')) continue;
          if (m.senderId !== sm.senderId) continue;
          if (String(m.text ?? '').trim() !== sText) continue;
          byId.delete(id);
          break;
        }
      }
      const merged = Array.from(byId.values());
      // Sort newest-first. ISO-8601 strings sort lexicographically, so direct string
      // comparison is correct and avoids the cost of constructing Date objects.
      merged.sort((a, b) => {
        const ta = a.createdAt || a.sentAt || '';
        const tb = b.createdAt || b.sentAt || '';
        return tb > ta ? 1 : tb < ta ? -1 : 0;
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

const DEFAULT_PAGE = 30;

function isOptimisticLocalId(id: string) {
  return id.startsWith('pending-');
}

/**
 * Fetches the next page of older messages and merges into the store.
 * Uses the chronologically oldest non-local message as the Firestore cursor.
 */
export async function loadOlderChatMessages(
  chatId: string,
  pageSize: number = DEFAULT_PAGE
): Promise<{ loaded: number; hasMore: boolean }> {
  const state = useChatStore.getState();
  const existing = state.messagesByChat[chatId] || [];
  const sortedAsc = [...existing].sort((a, b) => {
    const ta = new Date(a.createdAt || a.sentAt || 0).getTime();
    const tb = new Date(b.createdAt || b.sentAt || 0).getTime();
    return ta - tb;
  });
  const oldest = sortedAsc.find(m => m.id && !isOptimisticLocalId(m.id));
  if (!oldest) {
    return { loaded: 0, hasMore: false };
  }

  try {
    let older: ChatMessage[] = [];

    if (Platform.OS !== 'web' && hasNativeFirestore) {
      older = (await fetchOlderMessagesAfterNative(chatId, oldest.id, pageSize)) as ChatMessage[];
    } else {
      const messagesRef = collection(db, 'chats', chatId, 'messages');
      const oldestRef = doc(messagesRef, oldest.id);
      const oldestSnap = await getDoc(oldestRef);
      if (!oldestSnap.exists) {
        return { loaded: 0, hasMore: false };
      }
      const q = query(
        messagesRef,
        orderBy('createdAt', 'desc'),
        startAfter(oldestSnap),
        limit(pageSize)
      );
      const snapshot = await getDocs(q);
      snapshot.forEach((d) => {
        const data = d.data();
        older.push({
          id: d.id,
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

    const hasMore = older.length === pageSize;
    if (older.length === 0) {
      return { loaded: 0, hasMore: false };
    }

    const byId = new Map<string, ChatMessage>();
    for (const m of existing) {
      byId.set(m.id, m);
    }
    for (const m of older) {
      byId.set(m.id, m);
    }
    const pending = existing.filter(m => m.status === 'pending');
    for (const p of pending) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    const merged = Array.from(byId.values());
    merged.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
    state.setMessages(chatId, merged, false);
    return { loaded: older.length, hasMore };
  } catch (error) {
    if (__DEV__) console.error(`loadOlderChatMessages(${chatId}):`, error);
    return { loaded: 0, hasMore: true };
  }
}


