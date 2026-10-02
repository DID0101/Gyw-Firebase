import { InteractionManager, Platform } from 'react-native';

import { clearAndroidChatNotifications } from '@/lib/chatNotificationBridge';
import { logReadState } from '@/lib/readStateLog';
import { syncAndroidUnreadTotalFromChats } from '@/lib/unread/unreadTotals';
import { markMessagesAsRead } from '@/lib/services/chatService';
import { useChatStore } from '@/store/chatStore';

export type SyncChatReadOpts = {
  chatId: string;
  userId: string;
  /** Latest visible message id for read cursor (optional). */
  lastReadMessageId?: string;
  /** When true, clear tray notification even if Firestore write fails later. */
  clearNotification?: boolean;
  /** Skip Zustand unread reset (caller already applied optimistic update). */
  skipStoreReset?: boolean;
  /** Defer native notification + Firestore until after open transition (Android open perf). */
  deferNativeAndFirestore?: boolean;
  source: 'chatroom_open' | 'chatroom_messages' | 'mark_all' | 'notification_action' | 'app_resume';
};

/**
 * Single entry for marking a chat read: optimistic store + Firestore + native notifications.
 */
export async function syncChatReadState(opts: SyncChatReadOpts): Promise<void> {
  const {
    chatId,
    userId,
    lastReadMessageId,
    clearNotification = true,
    skipStoreReset = false,
    deferNativeAndFirestore = false,
    source,
  } = opts;
  if (!chatId || !userId) return;

  logReadState('CHATROOM_OPENED', { chatId, userId, source, lastReadMessageId });

  if (!skipStoreReset) {
    const chats = useChatStore.getState().chats;
    const prevUnread = chats.find((c) => c.id === chatId)?.unreadCount?.[userId] ?? 0;
    useChatStore.getState().bulkResetUnreadForUser(userId, [chatId]);
    if (prevUnread > 0) {
      logReadState('UNREAD_COUNT_UPDATED', { chatId, userId, from: prevUnread, to: 0, source });
    }
  }

  const persist = async () => {
    if (clearNotification && Platform.OS === 'android') {
      await clearAndroidChatNotifications(chatId);
      logReadState('NOTIFICATION_REMOVED', { chatId, source });
    }

    const updatedChats = useChatStore.getState().chats;
    await syncAndroidUnreadTotalFromChats(updatedChats, userId);

    try {
      await markMessagesAsRead(chatId, userId, { lastReadMessageId });
      logReadState('MESSAGE_MARK_READ', { chatId, userId, source, ok: true });
      logReadState('LAST_READ_TIMESTAMP_UPDATED', { chatId, userId, lastReadMessageId });
    } catch (e) {
      logReadState('MESSAGE_MARK_READ', {
        chatId,
        userId,
        source,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  };

  if (deferNativeAndFirestore) {
    InteractionManager.runAfterInteractions(() => {
      void persist().catch(() => {});
    });
    return;
  }

  await persist();
}
