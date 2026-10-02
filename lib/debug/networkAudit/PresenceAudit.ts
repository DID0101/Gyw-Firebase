/**
 * Counts presence / typing / status writes per minute while idle.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { currentHourBucket, getAuditScreen } from '@/lib/debug/networkAudit/auditContext';

export type PresenceWriteKind =
  | 'lastActive'
  | 'isOnline'
  | 'typing'
  | 'readState'
  | 'queueHeartbeat'
  | 'liveLocation'
  | 'other';

const IDLE_WARN_THRESHOLD_PER_MIN = 5;
const WINDOW_MS = 60_000;

const writesByKind = new Map<PresenceWriteKind, number[]>();
let patched = false;

function recordWrite(kind: PresenceWriteKind, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  const now = Date.now();
  const bucket = writesByKind.get(kind) ?? [];
  bucket.push(now);
  writesByKind.set(kind, bucket);

  while (bucket.length > 0 && now - bucket[0]! > WINDOW_MS) {
    bucket.shift();
  }

  DebugLogger.logPresence('PRESENCE_WRITE', {
    kind,
    screen: getAuditScreen(),
    hour: currentHourBucket(),
    writesInLast60s: bucket.length,
    ...detail,
  });

  if (bucket.length > IDLE_WARN_THRESHOLD_PER_MIN) {
    DebugLogger.warnPresence('HIGH_FREQUENCY_PRESENCE_UPDATES', {
      kind,
      writesInLast60s: bucket.length,
      threshold: IDLE_WARN_THRESHOLD_PER_MIN,
      screen: getAuditScreen(),
      message: `High frequency presence updates detected (${kind}: ${bucket.length}/min)`,
    });
  }
}

function wrapAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  original: T,
  kind: PresenceWriteKind,
  detailFn?: (...args: Parameters<T>) => Record<string, unknown>
): T {
  return (async (...args: Parameters<T>) => {
    recordWrite(kind, detailFn?.(...args));
    return original(...args);
  }) as T;
}

function patchTypingExports(): void {
  try {
    const chatService = require('@/lib/services/chatService') as {
      setTypingIndicator?: (...args: unknown[]) => Promise<unknown>;
    };
    if (typeof chatService.setTypingIndicator === 'function') {
      const original = chatService.setTypingIndicator;
      chatService.setTypingIndicator = wrapAsync(original, 'typing', (chatId, userId, isTyping) => ({
        chatId,
        userId: typeof userId === 'string' ? userId.slice(0, 8) : userId,
        isTyping,
      }));
    }
  } catch (err) {
    DebugLogger.warnPresence('PATCH_FAILED', { module: 'chatService', err: String(err) });
  }

  try {
    const firestoreNative = require('@/lib/firestoreNative') as {
      setTypingIndicatorNative?: (...args: unknown[]) => Promise<unknown>;
      setLiveLocationSessionNative?: (...args: unknown[]) => Promise<unknown>;
    };
    if (typeof firestoreNative.setTypingIndicatorNative === 'function') {
      const original = firestoreNative.setTypingIndicatorNative;
      firestoreNative.setTypingIndicatorNative = wrapAsync(original, 'typing', (chatId, userId, isTyping) => ({
        chatId,
        userId: typeof userId === 'string' ? userId.slice(0, 8) : userId,
        isTyping,
      }));
    }
    if (typeof firestoreNative.setLiveLocationSessionNative === 'function') {
      const original = firestoreNative.setLiveLocationSessionNative;
      firestoreNative.setLiveLocationSessionNative = wrapAsync(original, 'liveLocation', (chatId, messageId) => ({
        chatId,
        messageId,
      }));
    }
  } catch (err) {
    DebugLogger.warnPresence('PATCH_FAILED', { module: 'firestoreNative', err: String(err) });
  }

  try {
    const randomMatch = require('@/lib/services/randomMatchService') as {
      updateQueueHeartbeat?: (...args: unknown[]) => Promise<unknown>;
    };
    if (typeof randomMatch.updateQueueHeartbeat === 'function') {
      const original = randomMatch.updateQueueHeartbeat;
      randomMatch.updateQueueHeartbeat = wrapAsync(original, 'queueHeartbeat', (queueDocId) => ({
        queueDocId,
      }));
    }
  } catch (err) {
    DebugLogger.warnPresence('PATCH_FAILED', { module: 'randomMatchService', err: String(err) });
  }
}

export function installPresenceAudit(): void {
  if (!__DEV__ || patched) return;
  patched = true;
  patchTypingExports();
  DebugLogger.logPresence('PRESENCE_AUDIT_INSTALLED', {});
}

export function recordPresenceWrite(kind: PresenceWriteKind, detail?: Record<string, unknown>): void {
  recordWrite(kind, detail);
}

export function getPresenceWriteStats(): Record<PresenceWriteKind, number> {
  const now = Date.now();
  const out = {} as Record<PresenceWriteKind, number>;
  for (const [kind, timestamps] of writesByKind) {
    out[kind] = timestamps.filter((t) => now - t <= WINDOW_MS).length;
  }
  return out;
}
