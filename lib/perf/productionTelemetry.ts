/**
 * Production-safe telemetry — structured logs for profiling and hardening.
 *
 * In __DEV__: all events log to Metro.
 * In production: only `critical` events use console.error.
 */

type TelemetryLevel = 'debug' | 'info' | 'critical';

const APP_BOOT = typeof performance !== 'undefined' ? performance.now() : Date.now();

let peerConnectionCount = 0;

function shouldEmit(level: TelemetryLevel): boolean {
  if (level === 'critical') return true;
  return __DEV__;
}

function emit(tag: string, detail?: Record<string, unknown>, level: TelemetryLevel = 'info'): void {
  if (!shouldEmit(level)) return;
  const payload = detail ? ` ${JSON.stringify(detail)}` : '';
  if (level === 'critical') {
    console.error(`${tag}${payload}`);
  } else {
    console.log(`${tag}${payload}`);
  }
}

export function markAppStart(): void {
  emit('APP_START_TIME', { msSinceBoot: Math.round(APP_BOOT) });
}

export function logChatroomOpenMs(chatId: string, ms: number): void {
  emit('CHATROOM_OPEN_MS', { chatId, ms });
}

export function logFirestoreSubscribeMs(label: string, ms: number): void {
  emit('FIRESTORE_SUBSCRIBE_MS', { label, ms });
}

export function logMessageRenderCount(chatId: string, count: number): void {
  emit('MESSAGE_RENDER_COUNT', { chatId, count });
}

export function logNetworkStateChanged(snap: {
  reachability: string;
  isSlow: boolean;
  connectionType: string;
}): void {
  emit('NETWORK_STATE_CHANGED', snap);
}

export function logActionDuplicateBlocked(key: string, reason: string): void {
  emit('ACTION_DUPLICATE_BLOCKED', { key, reason });
}

export function logCallStateTransition(callId: string, from: string, to: string): void {
  emit('CALL_STATE_TRANSITION', { callId, from, to });
}

export function logStaleListenerRemoved(label: string): void {
  emit('STALE_LISTENER_REMOVED', { label });
}

export function logPeerConnectionDestroyed(callId?: string): void {
  peerConnectionCount = Math.max(0, peerConnectionCount - 1);
  emit('PEER_CONNECTION_DESTROYED', { callId, count: peerConnectionCount });
}

export function logPeerConnectionCreated(callId?: string): void {
  peerConnectionCount += 1;
  emit('WEBRTC_PEER_COUNT', { callId, count: peerConnectionCount });
}

export function logGlobalFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  emit('GLOBAL_FATAL_ERROR', { message }, 'critical');
}

export function logSafeAsyncCancelled(label: string): void {
  emit('SAFE_ASYNC_CANCELLED', { label });
}

/** Opt-in verbose contact tracing — off by default (floods Metro on large address books). */
let contactDiagEnabled = false;

export function setContactDiagEnabled(enabled: boolean): void {
  contactDiagEnabled = enabled;
}

export function logContactDiag(tag: string, detail: Record<string, unknown>): void {
  if (!__DEV__ || !contactDiagEnabled) return;
  emit(tag, detail, 'debug');
}

/** One-line summary after building the phone → name index. */
export function logContactIndexBuilt(rows: number, keys: number, region: string): void {
  if (!__DEV__) return;
  emit('CONTACT_INDEX_BUILT', { rows, keys, region });
}

export function logMemoryWarning(source: string): void {
  emit('MEMORY_WARNING', { source }, 'critical');
}

export function logOfflineQueueFlushed(count: number): void {
  emit('OFFLINE_QUEUE_FLUSHED', { count });
}

export function logMessageRetry(messageId: string, attempt: number): void {
  emit('MESSAGE_RETRY', { messageId, attempt });
}

export function logWebrtcIceReconnect(callId: string): void {
  emit('WEBRTC_ICE_RECONNECT', { callId });
}
