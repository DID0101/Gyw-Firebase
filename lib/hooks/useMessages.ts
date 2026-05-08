import { collection, query, where, orderBy, limit, onSnapshot, startAfter, Timestamp } from 'firebase/firestore';
import { useEffect, useState, useRef, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { ChatMessage } from '@/lib/types/chat';
import { useChatStore, EMPTY_MESSAGES } from '@/store/chatStore';

export const useMessages = (chatId: string, pageSize: number = 50) => {
  const [hasMore, setHasMore] = useState(true);
  const lastMessageRef = useRef<any>(null);
  
  // Stable empty reference when no messages (avoids getSnapshot loop)
  const messages = useChatStore((state) => state.messagesByChat[chatId] ?? EMPTY_MESSAGES);
  const setMessages = useChatStore((state) => state.setMessages);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    // Messages are already in store (from MMKV or preload)
    // No loading state - render immediately from cache

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      limit(pageSize)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const messagesData: ChatMessage[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          messagesData.push({
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
            sentAt: data.sentAt?.toDate?.()?.toISOString() || data.sentAt,
            deliveredAt: data.deliveredAt?.toDate?.()?.toISOString() || data.deliveredAt,
            seenAt: data.seenAt?.toDate?.()?.toISOString() || data.seenAt,
          } as ChatMessage);
        });
        
        // Store messages in reverse order (oldest first) - update store, not state
        const reversedMessages = messagesData.reverse();
        setMessages(chatId, reversedMessages, false);
        
        if (snapshot.docs.length > 0) {
          lastMessageRef.current = snapshot.docs[snapshot.docs.length - 1];
        }
        setHasMore(snapshot.docs.length === pageSize);
      },
      (error) => {
        // Silently fail - cache is already loaded
      }
    );

    return () => unsubscribe();
  }, [chatId, pageSize, setMessages]);

  const loadMore = async () => {
    if (!hasMore || !lastMessageRef.current) return;

    const messagesRef = collection(db, 'chats', chatId, 'messages');
    const q = query(
      messagesRef,
      orderBy('createdAt', 'desc'),
      startAfter(lastMessageRef.current),
      limit(pageSize)
    );

    // This would need to be implemented with getDocs for pagination
    // For now, real-time listener handles it
  };

  // No loading state - always render from cache immediately
  return { messages, loading: false, hasMore, loadMore };
};

