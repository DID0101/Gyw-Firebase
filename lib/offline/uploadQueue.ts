/**
 * Durable media upload queue — retried when network returns.
 */
import { retry } from '@/lib/reliability/RetryManager';
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  replaceQueue,
  type QueueItem,
} from '@/lib/reliability/StorageManager';
import { markQueueItemInFlight, clearQueueItemInFlight } from '@/lib/reliability/QueueSyncManager';
import { logQueue, logUpload } from '@/lib/reliability/reliabilityLog';
import { captureReliabilityError } from '@/lib/reliability/SentryManager';

export type PendingUploadPayload = {
  tempId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  fileUri: string;
  type: 'image' | 'video' | 'audio' | 'file' | 'document';
  fileName?: string;
  extraData?: Record<string, unknown>;
  replyTo?: Record<string, unknown>;
  sendOptions?: import('@/lib/services/chatService').SendChatMessageOptions;
};

const MAX_ATTEMPTS = 6;

export async function enqueuePendingUpload(payload: PendingUploadPayload): Promise<void> {
  await addToQueue('pendingUploads', payload.tempId, payload);
  logUpload('ENQUEUE', { tempId: payload.tempId, chatId: payload.chatId, type: payload.type });
}

export async function removePendingUpload(tempId: string): Promise<void> {
  await removeFromQueue('pendingUploads', tempId);
}

export async function flushUploadQueue(): Promise<void> {
  const items = await getQueue<PendingUploadPayload>('pendingUploads');
  if (items.length === 0) return;
  logQueue('FLUSH_START', { queue: 'pendingUploads', count: items.length });

  const { sendMediaMessage } = await import('@/lib/services/chatService');
  const remaining: QueueItem<PendingUploadPayload>[] = [];

  for (const item of items) {
    const flightKey = `upload:${item.id}`;
    if (!markQueueItemInFlight(flightKey)) continue;
    const p = item.payload;
    try {
      await retry(
        () =>
          sendMediaMessage(
            p.chatId,
            p.senderId,
            p.senderName,
            p.senderAvatar,
            p.fileUri,
            p.type,
            p.fileName,
            p.replyTo as any,
            p.extraData as any,
            p.sendOptions
          ),
        { label: 'flush_upload', maxRetries: 3, timeoutMs: 60_000 }
      );
      await removeFromQueue('pendingUploads', item.id);
      logUpload('FLUSH_OK', { tempId: item.id, chatId: p.chatId });
    } catch (err) {
      captureReliabilityError('upload', err, { tempId: item.id, attempts: item.attempts });
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        logUpload('FLUSH_DROPPED', { tempId: item.id, attempts });
      } else {
        remaining.push({ ...item, attempts });
        logUpload('FLUSH_RETRY', { tempId: item.id, attempts });
      }
    } finally {
      clearQueueItemInFlight(flightKey);
    }
  }

  if (remaining.length > 0) {
    const current = await getQueue<PendingUploadPayload>('pendingUploads');
    const merged = new Map(current.map((i) => [i.id, i]));
    for (const r of remaining) merged.set(r.id, r);
    await replaceQueue('pendingUploads', [...merged.values()]);
  }
  logQueue('FLUSH_END', { queue: 'pendingUploads', remaining: remaining.length });
}
