import { Platform } from 'react-native';

import { setAndroidChatUnreadTotal } from '@/lib/chatNotificationBridge';
import { logReadState } from '@/lib/readStateLog';
import { Chat } from '@/lib/types/chat';

export function sumUnreadForUser(chats: Chat[], userId: string): number {
  let total = 0;
  for (const c of chats) {
    total += c.unreadCount?.[userId] ?? 0;
  }
  return total;
}

/** Keeps Android tray badge / MessagingStyle global title aligned with Firestore-backed store. */
export async function syncAndroidUnreadTotalFromChats(
  chats: Chat[],
  userId: string
): Promise<void> {
  if (Platform.OS !== 'android' || !userId) return;
  const total = sumUnreadForUser(chats, userId);
  logReadState('UNREAD_COUNT_UPDATED', { scope: 'android_tray_total', userId, total });
  await setAndroidChatUnreadTotal(total);
}
