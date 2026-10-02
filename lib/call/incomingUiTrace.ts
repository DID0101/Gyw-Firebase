/** Trace every path that can surface incoming-call UI. Filter: INCOMING_UI_ */

export function logIncomingUiOpen(
  source: string,
  callId: string,
  detail?: Record<string, unknown>,
): void {
  console.log('INCOMING_UI_OPEN', {
    source,
    callId,
    timestamp: Date.now(),
    ...detail,
  });
}

export function logIncomingUiBlocked(
  source: string,
  callId: string,
  reason: string,
  detail?: Record<string, unknown>,
): void {
  console.log('INCOMING_UI_BLOCKED', {
    source,
    callId,
    reason,
    timestamp: Date.now(),
    ...detail,
  });
}

export function logRingEvent(
  event: 'RING_START' | 'RING_STOP' | 'RING_RESTART',
  callId: string,
  source: string,
): void {
  console.log(event, { callId, source, timestamp: Date.now() });
}
