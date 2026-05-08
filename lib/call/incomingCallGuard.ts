const WINDOW_MS = 60_000;
const entries = new Map<string, number>();

function prune(now: number) {
  for (const [callId, ts] of entries) {
    if (now - ts > WINDOW_MS) entries.delete(callId);
  }
}

export function tryAcquireIncomingCall(callId: string, source: string): boolean {
  const now = Date.now();
  prune(now);
  const allowed = !entries.has(callId);
  if (allowed) entries.set(callId, now);
  if (__DEV__) {
    console.log(
      `INCOMING_TRIGGER source=${source} callId=${callId} ts=${now} allowed=${allowed} duplicate=${!allowed}`
    );
  }
  return allowed;
}

export function releaseIncomingCall(callId?: string | null, reason = 'unknown'): void {
  if (!callId) return;
  const removed = entries.delete(callId);
  if (__DEV__) {
    console.log(
      `INCOMING_TRIGGER_RELEASE source=js_guard callId=${callId} ts=${Date.now()} reason=${reason} removed=${removed}`
    );
  }
}
