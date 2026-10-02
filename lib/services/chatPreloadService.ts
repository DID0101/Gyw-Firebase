import { getWarmChatLimit } from '@/lib/chatMessageLimits';
import {
    markChatWarmComplete,
    markMessageFirstSnapshot,
    markMessageListenerNativeStart,
} from '@/lib/chatOpenPerf';
import { db } from '@/lib/firebase';
import {
    fetchOlderMessagesAfterNative,
    getChatMessagesNative,
    hasNativeFirestore,
    subscribeToChatMessagesNative,
} from '@/lib/firestoreNative';
import { ChatMessage } from '@/lib/types/chat';
import { useChatStore } from '@/store/chatStore';
import { queueSaveMessages } from '@/store/persistence';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    startAfter,
} from 'firebase/firestore';
import { Platform } from 'react-native';

import { crashlyticsLog } from '@/lib/services/crashlyticsService';
import { startPerformanceTrace } from '@/lib/services/performanceService';

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
const warmPromises = new Map<string, Promise<void>>();
const warmStartedAt = new Map<string, number>();

/** Idle preload fetches that hang must not block navigation bootstrap. */
const STALE_WARM_MS = 8000;

/** RN Firebase: parallel getDocs + onSnapshot on the same query can deadlock on Android. */
let messageFetchChain: Promise<unknown> = Promise.resolve();

function enqueueMessageFetch<T>(fn: () => Promise<T>): Promise<T> {
  const next = messageFetchChain.then(fn, fn);
  messageFetchChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export type WarmChatOpts = {
  /** Drop in-flight warm and start a fresh Firestore fetch (navigation). */
  force?: boolean;
  /** List idle-preload — failures are non-fatal and must not log as errors. */
  background?: boolean;
  onHydrate?: (messageCount: number) => void;
};

const USER_WARM_FETCH_TIMEOUT_MS = 30000;
const BACKGROUND_WARM_FETCH_TIMEOUT_MS = 15000;

async function fetchMessagesFromFirestore(
  chatId: string,
  limit: number,
  timeoutMs: number
): Promise<ChatMessage[]> {
  const syncTrace = await startPerformanceTrace('sync_messages');
  syncTrace.putAttribute('chat_id', chatId.slice(0, 36));
  try {
    const messages = await enqueueMessageFetch(async () => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`message fetch timeout chatId=${chatId}`)), timeoutMs);
    });

    const fetchPromise = (async (): Promise<ChatMessage[]> => {
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        return (await getChatMessagesNative(chatId, limit)) as ChatMessage[];
      }
      const messagesRef = collection(db, 'chats', chatId, 'messages');
      const messagesQuery = query(messagesRef, orderBy('createdAt', 'desc'), limit(limit));
      const messagesSnapshot = await getDocs(messagesQuery);
      const messagesData: ChatMessage[] = [];
      messagesSnapshot.forEach((docSnap) => {
        messagesData.push(snapshotDataToChatMessage(docSnap.id, chatId, docSnap.data()));
      });
      return messagesData;
    })();

    return Promise.race([fetchPromise, timeoutPromise]);
  });
    await syncTrace.stop({ message_count: String(messages.length) });
    return messages;
  } catch (error) {
    await syncTrace.stop({ result: 'error' });
    throw error;
  }
}

function messagesHeadSignature(msgs: ChatMessage[]): string {
  if (msgs.length === 0) return '0';
  const head = msgs[0]!;
  const tail = msgs[msgs.length - 1]!;
  return `${msgs.length}:${head.id}:${head.status ?? ''}:${tail.id}`;
}

function mergeIncomingMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const pending = existing.filter((m) => m.status === 'pending');
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
  merged.sort((a, b) => {
    const ta = a.createdAt || a.sentAt || '';
    const tb = b.createdAt || b.sentAt || '';
    return tb > ta ? 1 : tb < ta ? -1 : 0;
  });
  return merged;
}

// Only ONE active listener at a time (current chat)
let activeChatListener: (() => void) | null = null;
let currentChatId: string | null = null;
/** Viewer uid for the active message listener — used to filter messages from blocked peers. */
let activeMessageListenerViewerUid: string | null = null;

export function isActiveMessageListener(chatId: string): boolean {
  return currentChatId === chatId && activeChatListener != null;
}

function filterMessagesForBlockedPeers(messages: ChatMessage[], viewerUid: string | null | undefined): ChatMessage[] {
  if (!viewerUid) return messages;
  const isBlocked = useUserBlocksStore.getState().isPeerBlocked;
  return messages.filter((m) => {
    if (!m.senderId || m.senderId === viewerUid) return true;
    return !isBlocked(m.senderId);
  });
}

/**
 * Warms up a chat when user shows intent (onPressIn).
 * Returns a promise so navigation can optionally await a short window when cache is empty.
 */
export function warmChat(
  chatId: string,
  messageLimit?: number,
  opts?: WarmChatOpts
): Promise<void> {
  if (!chatId) return Promise.resolve();
  const limit = messageLimit ?? getWarmChatLimit();
  const existingSync = useChatStore.getState().messagesByChat[chatId];
  if (existingSync && existingSync.length > 0) return Promise.resolve();

  // Never run getDocs while the live listener is attached — it deadlocks RN Firebase on Android.
  if (currentChatId === chatId && activeChatListener) {
    if (__DEV__) console.log(`CHAT_BOOTSTRAP_SKIP chatId=${chatId} reason=listener_active`);
    return Promise.resolve();
  }

  if (opts?.force) {
    warmPromises.delete(chatId);
    warmStartedAt.delete(chatId);
  }

  const inFlight = warmPromises.get(chatId);
  if (inFlight) {
    const started = warmStartedAt.get(chatId) ?? 0;
    if (started > 0 && Date.now() - started < STALE_WARM_MS) {
      return inFlight;
    }
    warmPromises.delete(chatId);
    warmStartedAt.delete(chatId);
  }

  const warmStarted = Date.now();
  warmStartedAt.set(chatId, warmStarted);
  const task = (async () => {
    warmingChatIds.add(chatId);
    try {
      const existingMessages = useChatStore.getState().messagesByChat[chatId];
      if (existingMessages && existingMessages.length > 0) return;

      if (__DEV__) console.log(`CHAT_BOOTSTRAP_START chatId=${chatId} force=${!!opts?.force} background=${!!opts?.background}`);
      const timeoutMs = opts?.background ? BACKGROUND_WARM_FETCH_TIMEOUT_MS : USER_WARM_FETCH_TIMEOUT_MS;
      const messagesData = await fetchMessagesFromFirestore(chatId, limit, timeoutMs);
      const store = useChatStore.getState();
      store.setMessagesSource(chatId, 'warm');
      store.setMessages(chatId, messagesData, true);
      markChatWarmComplete(chatId, Date.now() - warmStarted, messagesData.length);
      markMessageFirstSnapshot(chatId, messagesData.length);
      if (__DEV__) {
        console.log(`CHAT_BOOTSTRAP_DONE chatId=${chatId} count=${messagesData.length}`);
      }
      try {
        opts?.onHydrate?.(messagesData.length);
      } catch {
        /* non-fatal */
      }
    } catch (error) {
      const listenerActive = currentChatId === chatId && activeChatListener != null;
      if (__DEV__) {
        if (listenerActive || opts?.background) {
          console.warn(`CHAT_BOOTSTRAP_WARN chatId=${chatId}:`, error);
        } else {
          console.error(`Error warming chat ${chatId}:`, error);
        }
      }
    } finally {
      warmingChatIds.delete(chatId);
      warmStartedAt.delete(chatId);
    }
  })();

  warmPromises.set(chatId, task);
  void task.finally(() => {
    warmPromises.delete(chatId);
  });
  return task;
}

/** Resolve when warm finished or timeout — used for optional pre-nav wait when cache is empty. */
export async function waitForWarmChat(chatId: string, timeoutMs: number): Promise<boolean> {
  if (!chatId || timeoutMs <= 0) return false;
  const cached = useChatStore.getState().messagesByChat[chatId];
  if (cached && cached.length > 0) return true;

  const warmTask = warmPromises.get(chatId) ?? warmChat(chatId);
  const raced = await Promise.race([
    warmTask.then(() => (useChatStore.getState().messagesByChat[chatId]?.length ?? 0) > 0),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  return raced;
}

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
  if (__DEV__) {
    try {
      const { trackNamedListenerEvent } = require('@/lib/debug/networkAudit/ListenerTracker') as typeof import('@/lib/debug/networkAudit/ListenerTracker');
      trackNamedListenerEvent('START', 'chatMessageListener', { chatId, pageSize });
    } catch {
      /* audit toolkit optional */
    }
  }

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
    if (__DEV__) {
      console.log(`CHAT_LISTENER_SNAPSHOT chatId=${chatId} count=${incoming.length}`);
    }
    const state = useChatStore.getState();
    const existing = state.messagesByChat[chatId] || [];
    const existingIds = new Set(existing.map((m) => m.id));
    const receivedFromOthers = incoming.filter(
      (m) =>
        m.senderId &&
        m.senderId !== activeMessageListenerViewerUid &&
        !existingIds.has(m.id) &&
        !m.id.startsWith('pending-')
    );
    if (receivedFromOthers.length > 0) {
      crashlyticsLog(
        `message_received chatId=${chatId.slice(0, 8)} count=${receivedFromOthers.length}`
      );
    }
    const pending = existing.filter((m) => m.status === 'pending');
    const incomingSig = messagesHeadSignature(incoming);
    const existingSig = messagesHeadSignature(existing);

    if (
      pending.length === 0 &&
      incoming.length > 0 &&
      incomingSig === existingSig
    ) {
      state.setMessagesSource(chatId, 'live');
      queueSaveMessages(chatId, existing);
      if (!firstSnapshotMarked) {
        firstSnapshotMarked = true;
        markMessageFirstSnapshot(chatId, existing.length);
        try {
          onFirstHydrate?.(existing.length);
        } catch {
          /* non-fatal */
        }
      }
      return;
    }

    const merged = mergeIncomingMessages(existing, incoming);
    state.setMessagesSource(chatId, 'live');
    state.setMessages(chatId, merged, true);
    if (!firstSnapshotMarked) {
      firstSnapshotMarked = true;
      markMessageFirstSnapshot(chatId, merged.length);
      try {
        onFirstHydrate?.(merged.length);
      } catch {
        /* non-fatal */
      }
    }
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
      { includeMetadataChanges: false },
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
  if (__DEV__) {
    try {
      const { trackNamedListenerEvent } = require('@/lib/debug/networkAudit/ListenerTracker') as typeof import('@/lib/debug/networkAudit/ListenerTracker');
      trackNamedListenerEvent('STOP', 'chatMessageListener', { chatId: currentChatId });
    } catch {
      /* audit toolkit optional */
    }
  }
  if (activeChatListener) {
    activeChatListener();
    activeChatListener = null;
    currentChatId = null;
    activeMessageListenerViewerUid = null;
  }
};

/** Update blocked-peer filter without tearing down the live message listener. */
export function setMessageListenerViewerUid(viewerUid: string | null | undefined) {
  activeMessageListenerViewerUid = viewerUid ?? null;
}

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
    state.setMessages(chatId, merged, true);
    return { loaded: older.length, hasMore };
  } catch (error) {
    if (__DEV__) console.error(`loadOlderChatMessages(${chatId}):`, error);
    return { loaded: 0, hasMore: true };
  }
}


