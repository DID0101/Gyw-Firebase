/**
 * Generic failed-request queue — MMKV-backed, flushed last on reconnect.
 */
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

export type FailedRequestPayload = {
  queueType: string;
  payload: unknown;
};

type Processor = (payload: unknown) => Promise<void>;

const processors = new Map<string, Processor>();
const MAX_ATTEMPTS = 8;

export function registerQueueProcessor(queueType: string, processor: Processor): void {
  processors.set(queueType, processor);
}

export async function enqueueOfflineItem<T>(
  queueType: string,
  id: string,
  payload: T
): Promise<void> {
  const wrapped: FailedRequestPayload = { queueType, payload };
  await addToQueue('failedRequestsQueue', `${queueType}:${id}`, wrapped);
  logQueue('ENQUEUE', { queueType, id });
}

export async function removeOfflineItem(queueType: string, id: string): Promise<void> {
  await removeFromQueue('failedRequestsQueue', `${queueType}:${id}`);
}

export async function flushFailedRequestsQueue(): Promise<void> {
  const items = await getQueue<FailedRequestPayload>('failedRequestsQueue');
  if (items.length === 0) return;
  logQueue('FLUSH_START', { queue: 'failedRequestsQueue', count: items.length });
  const remaining: QueueItem<FailedRequestPayload>[] = [];

  for (const item of items) {
    const flightKey = `failed:${item.id}`;
    if (!markQueueItemInFlight(flightKey)) continue;
    const { queueType, payload } = item.payload;
    const processor = processors.get(queueType);
    if (!processor) {
      clearQueueItemInFlight(flightKey);
      continue;
    }
    try {
      await retry(() => processor(payload), {
        label: `queue_${queueType}`,
        maxRetries: 3,
        timeoutMs: 30_000,
      });
      await removeFromQueue('failedRequestsQueue', item.id);
      logQueue('FLUSH_ITEM_OK', { queue: 'failedRequestsQueue', id: item.id });
    } catch (err) {
      captureReliabilityError('queue', err, { id: item.id, queueType, attempts: item.attempts });
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        logQueue('FLUSH_ITEM_DROPPED', { queue: 'failedRequestsQueue', id: item.id, attempts });
      } else {
        remaining.push({ ...item, attempts });
        logQueue('FLUSH_ITEM_RETRY', { queue: 'failedRequestsQueue', id: item.id, attempts });
      }
    } finally {
      clearQueueItemInFlight(flightKey);
    }
  }

  if (remaining.length > 0) {
    const current = await getQueue<FailedRequestPayload>('failedRequestsQueue');
    const merged = new Map(current.map((i) => [i.id, i]));
    for (const r of remaining) merged.set(r.id, r);
    await replaceQueue('failedRequestsQueue', [...merged.values()]);
  }
  logQueue('FLUSH_END', { queue: 'failedRequestsQueue', remaining: remaining.length });
}

/** @deprecated Use startQueueSyncManager */
export function startOfflineQueueSync(): void {
  /* no-op */
}

export async function flushOfflineQueue(_queueType?: string): Promise<void> {
  await flushFailedRequestsQueue();
}
