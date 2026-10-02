/**
 * Durable text message outbox — MMKV-backed, auto-flushes on reconnect.
 */
import { sendMessage, type SendChatMessageOptions } from '@/lib/services/chatService';
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  replaceQueue,
  type QueueItem,
} from '@/lib/reliability/StorageManager';
import { retry } from '@/lib/reliability/RetryManager';
import { markQueueItemInFlight, clearQueueItemInFlight } from '@/lib/reliability/QueueSyncManager';
import { logQueue } from '@/lib/reliability/reliabilityLog';
import { captureReliabilityError } from '@/lib/reliability/SentryManager';
import { useChatStore } from '@/store/chatStore';

export type OutboxEntry = {
  tempId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  replyTo?: {
    messageId: string;
    senderName: string;
    text?: string;
    type?: string;
  };
  sendOptions?: SendChatMessageOptions;
  createdAt: string;
};

const MAX_ATTEMPTS = 8;

export async function enqueueOutboxMessage(entry: OutboxEntry): Promise<void> {
  await addToQueue('pendingMessages', entry.tempId, entry);
}

export async function removeOutboxMessage(tempId: string): Promise<void> {
  await removeFromQueue('pendingMessages', tempId);
}

export async function flushMessageOutbox(): Promise<void> {
  const items = await getQueue<OutboxEntry>('pendingMessages');
  if (items.length === 0) return;
  logQueue('FLUSH_START', { queue: 'pendingMessages', count: items.length });
  const remaining: QueueItem<OutboxEntry>[] = [];

  for (const item of items) {
    const flightKey = `message:${item.id}`;
    if (!markQueueItemInFlight(flightKey)) continue;
    const entry = item.payload;
    try {
      const messageId = await retry(
        () =>
          sendMessage(
            entry.chatId,
            entry.senderId,
            entry.senderName,
            entry.senderAvatar,
            entry.text,
            entry.replyTo,
            entry.sendOptions
          ),
        { label: 'outbox_send_message', maxRetries: 4, timeoutMs: 30_000 }
      );
      useChatStore.getState().updateMessage(entry.chatId, entry.tempId, {
        id: messageId,
        status: 'sent',
      });
      await removeFromQueue('pendingMessages', item.id);
      logQueue('FLUSH_ITEM_OK', { queue: 'pendingMessages', id: item.id });
    } catch (err) {
      captureReliabilityError('firestore', err, { tempId: item.id, attempts: item.attempts });
      useChatStore.getState().updateMessage(entry.chatId, entry.tempId, { status: 'failed' });
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        logQueue('FLUSH_ITEM_DROPPED', { queue: 'pendingMessages', id: item.id, attempts });
      } else {
        remaining.push({ ...item, attempts });
        logQueue('FLUSH_ITEM_RETRY', { queue: 'pendingMessages', id: item.id, attempts });
      }
    } finally {
      clearQueueItemInFlight(flightKey);
    }
  }

  if (remaining.length > 0) {
    const current = await getQueue<OutboxEntry>('pendingMessages');
    const merged = new Map(current.map((i) => [i.id, i]));
    for (const r of remaining) merged.set(r.id, r);
    await replaceQueue('pendingMessages', [...merged.values()]);
  }
  logQueue('FLUSH_END', { queue: 'pendingMessages', remaining: remaining.length });
}

/** @deprecated Use startQueueSyncManager — kept for backward compatibility. */
export function startMessageOutboxRetryListener(): void {
  /* no-op — QueueSyncManager owns reconnect flush */
}
