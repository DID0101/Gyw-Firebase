/**
 * Ordered queue flush on reconnect — signup → messages → uploads → failed requests.
 * Single coordinator prevents duplicate execution.
 */
import { flushMessageOutbox } from '@/lib/offline/messageOutbox';
import { flushUploadQueue } from '@/lib/offline/uploadQueue';
import { flushFailedRequestsQueue } from '@/lib/reliability/OfflineQueue';
import { flushSignupQueue } from '@/lib/auth/signupQueue';
import { migrateLegacyQueues } from '@/lib/reliability/StorageManager';
import { subscribeToReconnect, startNetworkManager } from '@/lib/reliability/NetworkManager';
import { logSync } from '@/lib/reliability/reliabilityLog';
import { getQueueSize } from '@/lib/reliability/StorageManager';
import { setSyncPhase } from '@/lib/offline/syncStatus';

let started = false;
let flushInFlight = false;
const inFlightIds = new Set<string>();

export function markQueueItemInFlight(key: string): boolean {
  if (inFlightIds.has(key)) return false;
  inFlightIds.add(key);
  return true;
}

export function clearQueueItemInFlight(key: string): void {
  inFlightIds.delete(key);
}

export async function flushAllQueues(): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  const startedAt = Date.now();
  const totalPending =
    (await getQueueSize('pendingSignups')) +
    (await getQueueSize('pendingMessages')) +
    (await getQueueSize('pendingUploads')) +
    (await getQueueSize('failedRequestsQueue'));

  logSync('FLUSH_ALL_START', {
    pendingSignups: await getQueueSize('pendingSignups'),
    pendingMessages: await getQueueSize('pendingMessages'),
    pendingUploads: await getQueueSize('pendingUploads'),
    failedRequests: await getQueueSize('failedRequestsQueue'),
  });

  if (totalPending > 0) {
    setSyncPhase('syncing', totalPending);
  }

  try {
    await flushSignupQueue();
    await flushMessageOutbox();
    await flushUploadQueue();
    await flushFailedRequestsQueue();
    logSync('FLUSH_ALL_DONE', { durationMs: Date.now() - startedAt });
    if (totalPending > 0) {
      setSyncPhase('done', 0);
    }
  } catch (err) {
    logSync('FLUSH_ALL_ERROR', {
      durationMs: Date.now() - startedAt,
      reason: err instanceof Error ? err.message : String(err),
    });
    if (totalPending > 0) {
      setSyncPhase('error', totalPending);
    }
  } finally {
    flushInFlight = false;
  }
}

export function startQueueSyncManager(): void {
  if (started) return;
  started = true;
  startNetworkManager();
  void migrateLegacyQueues().then(() => flushAllQueues());
  subscribeToReconnect(() => {
    logSync('RECONNECT_TRIGGER', {});
    void flushAllQueues();
  });
}
