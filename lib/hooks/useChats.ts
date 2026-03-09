import { Platform } from 'react-native';
import { db } from '@/lib/firebase';
import { Chat } from '@/lib/types/chat';
import { hasNativeFirestore, subscribeToChatsNative } from '@/lib/firestoreNative';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect } from 'react';
import { useChatStore } from '@/store/chatStore';

export const useChats = (userId: string) => {
  // Read chats from store instead of local state
  const chats = useChatStore((state) => state.chats);
  const setChats = useChatStore((state) => state.setChats);

  useEffect(() => {
    if (!userId) {
      return;
    }

    // On native: use RN Firebase (shares auth with phone sign-in). Web SDK would get "permission denied".
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      const unsubscribe = subscribeToChatsNative(
        userId,
        (chatsData) => setChats(chatsData as Chat[]),
        (err) => {
          if (__DEV__) console.error('[useChats] Native snapshot error:', err);
        }
      );
      return unsubscribe;
    }

    // Web: use web SDK Firestore
    const chatsRef = collection(db, 'chats');
    const q = query(
      chatsRef,
      where('participants', 'array-contains', userId),
      orderBy('lastMessageAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const chatsData: Chat[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          const lastMessageAt = data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt || data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || data.createdAt?.toDate?.()?.toISOString() || data.createdAt;
          chatsData.push({
            id: doc.id,
            ...data,
            lastMessageAt,
            lastSenderId: data.lastSenderId ?? data.lastMessage?.senderId,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
          } as Chat);
        });
        setChats(chatsData);
      },
      (error) => {
        if (__DEV__) console.error('[useChats] Snapshot error:', error);
      }
    );

    return () => unsubscribe();
  }, [userId, setChats]);

  // No loading state - always render from cache immediately
  return { chats, loading: false };
};

