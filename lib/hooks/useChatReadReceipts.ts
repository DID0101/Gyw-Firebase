import { useCallback, useEffect, useRef } from 'react';

import { InteractionManager } from 'react-native';

import {

  markMessageAsDelivered,

  markMessageAsSeen,

} from '@/lib/services/chatService';

import { syncChatReadState } from '@/lib/services/readStateService';

import { Chat, ChatMessage } from '@/lib/types/chat';

import { useChatStore } from '@/store/chatStore';



const READ_DEBOUNCE_MS = 400;

const DELIVERED_DEBOUNCE_MS = 600;

const SEEN_DEBOUNCE_MS = 750;

const MAX_DELIVERED_BATCH = 12;

const MAX_SEEN_BATCH = 8;



type UseChatReadReceiptsOpts = {

  chatId: string | undefined;

  userId: string | undefined;

  chat: Chat | null;

  /** Skip Firestore writes until the list has had a first hydrate (open perf). */

  streamHydrated: boolean;

};



/**

 * Batches read/delivered/seen receipts so opening a chat does not fan out N writes.

 */

export function useChatReadReceipts({

  chatId,

  userId,

  chat,

  streamHydrated,

}: UseChatReadReceiptsOpts) {

  const deliveredIdsRef = useRef(new Set<string>());

  const seenIdsRef = useRef(new Set<string>());

  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readInFlightRef = useRef(false);

  const deliveredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingDeliveredRef = useRef<Set<string>>(new Set());

  const pendingSeenRef = useRef<{ id: string; readBy?: string[]; senderId?: string }[]>([]);



  const flushDelivered = useCallback(() => {

    if (!chatId || !userId) return;

    const batch = Array.from(pendingDeliveredRef.current).slice(0, MAX_DELIVERED_BATCH);

    pendingDeliveredRef.current.clear();

    if (batch.length === 0) return;

    batch.forEach((id) => {

      deliveredIdsRef.current.add(id);

      void markMessageAsDelivered(chatId, id).catch(() => {

        deliveredIdsRef.current.delete(id);

      });

    });

  }, [chatId, userId]);



  const flushSeen = useCallback(() => {

    if (!chatId || !userId) return;

    const batch = pendingSeenRef.current.splice(0, MAX_SEEN_BATCH);

    if (batch.length === 0) return;

    batch.forEach((message) => {

      seenIdsRef.current.add(message.id);

      void markMessageAsSeen(chatId, message.id, userId, {

        chatType: (chat?.type as 'direct' | 'group') ?? undefined,

        messageReadBy: message.readBy,

        messageSenderId: message.senderId,

        chatParticipants: chat?.participants,

      }).catch(() => {

        seenIdsRef.current.delete(message.id);

      });

    });

  }, [chatId, userId, chat?.type, chat?.participants]);



  const queueDelivered = useCallback(

    (messageIds: string[]) => {

      if (!streamHydrated || !chatId || !userId) return;

      for (const id of messageIds) {

        if (deliveredIdsRef.current.has(id)) continue;

        pendingDeliveredRef.current.add(id);

      }

      if (deliveredTimerRef.current) return;

      deliveredTimerRef.current = setTimeout(() => {

        deliveredTimerRef.current = null;

        flushDelivered();

        if (pendingDeliveredRef.current.size > 0) queueDelivered([]);

      }, DELIVERED_DEBOUNCE_MS);

    },

    [chatId, userId, streamHydrated, flushDelivered]

  );



  const queueSeen = useCallback(

    (messages: { id: string; readBy?: string[]; senderId?: string }[]) => {

      if (!streamHydrated || !chatId || !userId) return;

      for (const m of messages) {

        if (seenIdsRef.current.has(m.id)) continue;

        pendingSeenRef.current.push(m);

      }

      if (seenTimerRef.current) return;

      seenTimerRef.current = setTimeout(() => {

        seenTimerRef.current = null;

        flushSeen();

        if (pendingSeenRef.current.length > 0) queueSeen([]);

      }, SEEN_DEBOUNCE_MS);

    },

    [chatId, userId, streamHydrated, flushSeen]

  );



  const onViewableMessages = useCallback(

    (viewable: ChatMessage[]) => {

      if (!userId || !chatId) return;

      const toDeliver: string[] = [];

      const toSee: { id: string; readBy?: string[]; senderId?: string }[] = [];

      for (const message of viewable) {

        if (message.senderId === userId) continue;

        if (

          message.status !== 'delivered' &&

          message.status !== 'seen' &&

          message.status !== 'pending' &&

          message.status !== 'failed' &&

          !deliveredIdsRef.current.has(message.id)

        ) {

          toDeliver.push(message.id);

        }

        if (message.status !== 'seen' && !seenIdsRef.current.has(message.id)) {

          toSee.push({

            id: message.id,

            readBy: message.readBy,

            senderId: message.senderId,

          });

        }

      }

      if (toDeliver.length) queueDelivered(toDeliver);

      if (toSee.length) queueSeen(toSee);

    },

    [chatId, userId, queueDelivered, queueSeen]

  );



  const messages = useChatStore((s) => (chatId ? s.messagesByChat[chatId] : undefined));

  const messageCount = messages?.length ?? 0;

  const latestPeerMessageId = (() => {

    if (!messages?.length || !userId) return undefined;

    for (let i = messages.length - 1; i >= 0; i--) {

      const m = messages[i];

      if (m.senderId && m.senderId !== userId) return m.id;

    }

    return messages[messages.length - 1]?.id;

  })();



  const scheduleMarkChatRead = useCallback(() => {

    if (!streamHydrated || !userId || !chatId || messageCount === 0) return;

    if (readTimerRef.current) clearTimeout(readTimerRef.current);

    readTimerRef.current = setTimeout(() => {

      readTimerRef.current = null;

      if (readInFlightRef.current) return;

      readInFlightRef.current = true;

      void syncChatReadState({

        chatId,

        userId,

        lastReadMessageId: latestPeerMessageId,

        source: 'chatroom_messages',

      })

        .catch(() => {})

        .finally(() => {

          readInFlightRef.current = false;

        });

    }, READ_DEBOUNCE_MS);

  }, [chatId, userId, messageCount, streamHydrated, latestPeerMessageId]);



  useEffect(() => {

    deliveredIdsRef.current.clear();

    seenIdsRef.current.clear();

    pendingDeliveredRef.current.clear();

    pendingSeenRef.current = [];

    readInFlightRef.current = false;

    if (readTimerRef.current) {

      clearTimeout(readTimerRef.current);

      readTimerRef.current = null;

    }

    if (deliveredTimerRef.current) {

      clearTimeout(deliveredTimerRef.current);

      deliveredTimerRef.current = null;

    }

    if (seenTimerRef.current) {

      clearTimeout(seenTimerRef.current);

      seenTimerRef.current = null;

    }

  }, [chatId]);



  useEffect(() => {

    if (!streamHydrated || !userId || !chatId || messageCount === 0) return;

    const task = InteractionManager.runAfterInteractions(() => {

      scheduleMarkChatRead();

    });

    return () => {

      task.cancel?.();

    };

  }, [chatId, userId, messageCount, streamHydrated, scheduleMarkChatRead]);



  useEffect(() => {

    return () => {

      if (deliveredTimerRef.current) clearTimeout(deliveredTimerRef.current);

      if (seenTimerRef.current) clearTimeout(seenTimerRef.current);

      if (readTimerRef.current) clearTimeout(readTimerRef.current);

    };

  }, []);



  return { onViewableMessages, scheduleMarkChatRead };

}


