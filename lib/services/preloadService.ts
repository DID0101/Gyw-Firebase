import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Chat } from '@/lib/types/chat';
import { useChatStore } from '@/store/chatStore';
import { useStoryStore } from '@/store/storyStore';
import { useCallStore } from '@/store/callStore';
import { getStories } from './storyService';
import { getCallHistory } from './callService';
import { hasNativeFirestore, getChatsNative, getCallHistoryNative, getStoriesNative } from '@/lib/firestoreNative';

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
        // Index may still be building after deploy - keep cached data, don't crash
        if (__DEV__) console.warn('[preload] Chats query failed (index building?):', err?.message);
        chatsData = useChatStore.getState().chats;
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
        if (__DEV__) console.warn('[preload] Chats query failed (index building?):', err?.message);
        chatsData = useChatStore.getState().chats;
      }
    }
    useChatStore.getState().setChats(chatsData);

    // 2. Preload active stories
    let callsCount = 0;
    try {
      const stories = hasNativeFirestore ? await getStoriesNative() : await getStories();
      useStoryStore.getState().setStories(stories);
    } catch (error) {
      if (__DEV__) console.error('Error preloading stories:', error);
    }

    // 3. Preload call history (last 50 calls)
    try {
      const calls = hasNativeFirestore ? await getCallHistoryNative(userId, 50) : await getCallHistory(userId, 50);
      useCallStore.getState().setCalls(calls);
      callsCount = calls.length;
    } catch (error) {
      if (__DEV__) console.error('Error preloading calls:', error);
    }
    
    // 4. Preload presence for chat participants
    const participantIds = new Set<string>();
    chatsData.forEach(chat => {
      chat.participants.forEach(id => {
        if (id !== userId) participantIds.add(id);
      });
    });
    
    // Presence will be updated by real-time listeners
    // We just initialize the store structure here
    
    if (__DEV__) {
      console.log(`Preloaded: ${chatsData.length} chats, ${callsCount} calls, ${participantIds.size} participants`);
    }
  } catch (error) {
    if (__DEV__) console.error('Error preloading app data:', error);
  }
};

