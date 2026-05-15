import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Chat } from '@/lib/types/chat';
import { useChatStore } from '@/store/chatStore';
import { useStoryStore } from '@/store/storyStore';
import { useCallStore } from '@/store/callStore';
import { getStories } from './storyService';
import { getCallHistory } from './callService';
import { hasNativeFirestore, getChatsNative, getCallHistoryNative, getStoriesNative } from '@/lib/firestoreNative';
import { runOnIdle } from '@/lib/perf/defer';

function isFirestorePermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = String((err as { message?: string })?.message || '');
  return code === 'firestore/permission-denied' || msg.includes('permission-denied');
}

/**
 * Loads data from AsyncStorage first (instant load)
 * Then syncs with Firestore in background
 */
export const loadFromStorage = async () => {
  // Load all stores in parallel (non-blocking)
  await Promise.all([
    useChatStore.getState().loadFromStorage(),
    useCallStore.getState().loadFromStorage(),
    useStoryStore.getState().loadFromStorage(),
  ]);
};

/**
 * Preloads data when app starts to populate in-memory cache
 * This makes opening chats/stories/calls instant
 * Runs in background after initial MMKV load
 */
export const preloadAppData = async (userId: string) => {
  try {
    // 1. Preload recent chats (last 20) - use native Firestore on native (shares auth)
    let chatsData: Chat[];
    if (hasNativeFirestore) {
      try {
        chatsData = await getChatsNative(userId, 20);
        // Already ordered by lastMessageAt desc from query
      } catch (err: any) {
        if (__DEV__) console.warn('[preload] Chats query failed:', err?.message);
        // Never reuse persisted chats on PERMISSION_DENIED — keys are not user-scoped, so cache may be another account's IDs.
        chatsData = isFirestorePermissionDenied(err) ? [] : useChatStore.getState().chats;
      }
    } else {
      try {
        const chatsRef = collection(db, 'chats');
        const chatsQuery = query(
          chatsRef,
          where('participants', 'array-contains', userId),
          orderBy('lastMessageAt', 'desc'),
          limit(20)
        );
        const chatsSnapshot = await getDocs(chatsQuery);
        chatsData = [];
        chatsSnapshot.forEach((doc) => {
          const data = doc.data();
          chatsData.push({
            id: doc.id,
            ...data,
            lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt || data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            lastSenderId: data.lastSenderId ?? data.lastMessage?.senderId,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
          } as Chat);
        });
      } catch (err: any) {
        if (__DEV__) console.warn('[preload] Chats query failed:', err?.message);
        chatsData = isFirestorePermissionDenied(err) ? [] : useChatStore.getState().chats;
      }
    }
    useChatStore.getState().setChats(chatsData);

    // Stories + call history are not needed for first paint; yield then hydrate in background.
    void preloadStoriesAndCalls(userId, chatsData.length);
  } catch (error) {
    if (__DEV__) console.error('Error preloading app data:', error);
  }
};

/** Deferred so chat list / tab UI can commit before extra Firestore + JSON work. */
async function preloadStoriesAndCalls(userId: string, chatCount: number) {
  await new Promise<void>((r) => setTimeout(r, 0));

  let callsCount = 0;

  runOnIdle(() => {
    void (async () => {
      try {
        const stories = hasNativeFirestore ? await getStoriesNative() : await getStories();
        useStoryStore.getState().setStories(stories);
      } catch (error) {
        if (__DEV__) console.error('Error preloading stories:', error);
      }
    })();
  }, 40);

  runOnIdle(() => {
    void (async () => {
      try {
        const calls = hasNativeFirestore ? await getCallHistoryNative(userId, 30) : await getCallHistory(userId, 30);
        useCallStore.getState().setCalls(calls);
        callsCount = calls.length;
      } catch (error) {
        if (__DEV__) console.error('Error preloading calls:', error);
      }
      if (__DEV__) {
        console.log(`Preloaded (deferred): chats=${chatCount}, calls=${callsCount}`);
      }
    })();
  }, 220);
}

