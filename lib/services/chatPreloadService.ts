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
import {
  markMessageFirstSnapshot,
  markMessageListenerNativeStart,
} from '@/lib/chatOpenPerf';
import { useChatStore } from '@/store/chatStore';
import { useUserBlocksStore } from '@/store/userBlocksStore';

/** Shared mapping from Firestore message doc → `ChatMessage` (web listener / pagination). */
function snapshotDataToChatMessage(docId: string, chatId: string, data: any): ChatMessage {
  const edited = !!(data.edited || data.isEdited);
  return {
    id: docId,
    chatId,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
    sentAt: data.sentAt?.toDate?.()?.toISOString() || data.sentAt,
    deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || data.deliveredAt,
    seenAt: data.seenAt?.toDate?.()?.toISOString() || data.seenAt,
    edited,
    isEdited: !!(data.isEdited ?? edited),
    editedAt: data.editedAt?.toDate?.()?.toISOString() || data.editedAt,
    deleted: !!data.deleted,
    deletedForEveryone: !!data.deletedForEveryone,
    deletedAt: data.deletedAt?.toDate?.()?.toISOString() || data.deletedAt,
    deletedFor: data.deletedFor || [],
  } as ChatMessage;
}

/** Avoid duplicate concurrent warmChat fetches for the same room (tap spam / list preload overlap). */
const warmingChatIds = new Set<string>();

// Only ONE active listener at a time (current chat)
let activeChatListener: (() => void) | null = null;
let currentChatId: string | null = null;
/** Viewer uid for the active message listener — used to filter messages from blocked peers. */
let activeMessageListenerViewerUid: string | null = null;

function filterMessagesForBlockedPeers(messages: ChatMessage[], viewerUid: string | null | undefined): ChatMessage[] {
  if (!viewerUid) return messages;
  const isBlocked = useUserBlocksStore.getState().isPeerBlocked;
  return messages.filter((m) => {
    if (!m.senderId || m.senderId === viewerUid) return true;
    return !isBlocked(m.senderId);
  });
}

/**
 * Warms up a chat when user shows intent (onPressIn)
 * Only loads if not already in store
 * Non-blocking, happens ~150ms before navigation
 */
export const warmChat = async (chatId: string, messageLimit: number = 20) => {
  if (!chatId || warmingChatIds.has(chatId)) return;
  const existingSync = useChatStore.getState().messagesByChat[chatId];
  if (existingSync && existingSync.length > 0) return;

  warmingChatIds.add(chatId);
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
          messagesData.push(snapshotDataToChatMessage(doc.id, chatId, doc.data()));
        });
      }
      useChatStore.getState().setMessages(chatId, messagesData, false);
    } catch (error) {
      if (__DEV__) console.error(`Error warming chat ${chatId}:`, error);
    } finally {
      warmingChatIds.delete(chatId);
    }
  })();
};

/**
 * Starts a Firestore listener for a chat's messages
 * ONLY ONE listener active at a time (current chat)
 * Updates store silently in background
 */
export const startChatMessageListener = (
  chatId: string,
  pageSize: number = 50,
  /** Fires once after the first snapshot is merged (count may be 0). Use for skeleton → list UX. */
  onFirstHydrate?: (messageCount: number) => void,
  opts?: { viewerUid?: string }
) => {
  if (currentChatId === chatId && activeChatListener) {
    activeMessageListenerViewerUid = opts?.viewerUid ?? null;
    return;
  }

  if (activeChatListener) {
    activeChatListener();
    activeChatListener = null;
    currentChatId = null;
  }

  activeMessageListenerViewerUid = opts?.viewerUid ?? null;

  markMessageListenerNativeStart(chatId);
  let firstSnapshotMarked = false;

  const applyMessages = (messagesData: ChatMessage[]) => {
    const incoming = filterMessagesForBlockedPeers(messagesData, activeMessageListenerViewerUid);
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
      for (const m of incoming) {
        byId.set(m.id, m);
      }
      for (const p of pending) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
      // Firestore snapshot can arrive before updateMessage() re-keys the optimistic row:
      // same send appears as both `pending-*` and the real doc id → duplicate bubbles / duplicate keys.
      for (const sm of incoming) {
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
      if (!firstSnapshotMarked) {
        firstSnapshotMarked = true;
        markMessageFirstSnapshot(chatId, merged.length);
        try {
          onFirstHydrate?.(merged.length);
        } catch {
          /* non-fatal */
        }
      }
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
    activeMessageListenerViewerUid = null;
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
    activeMessageListenerViewerUid = null;
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
        older.push(snapshotDataToChatMessage(d.id, chatId, d.data()));
      });
    }

    const hasMore = older.length === pageSize;
    if (older.length === 0) {
      return { loaded: 0, hasMore: false };
    }

    const viewerUid = activeMessageListenerViewerUid;
    if (viewerUid) {
      older = filterMessagesForBlockedPeers(older, viewerUid);
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


