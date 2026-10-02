/**
 * End-to-end call latency instrumentation (ms since CALL_START_T0 per callId).
 *
 * Filter logcat / Metro: CALL_LATENCY
 */

export type CallLatencyTag =
  | 'CALL_START_T0'
  | 'CALL_DOC_CREATED'
  | 'FCM_SENT'
  | 'FCM_RECEIVED'
  | 'TELECOM_INCOMING_ADDED'
  | 'INCOMING_UI_VISIBLE'
  | 'RINGTONE_STARTED'
  | 'ACCEPT_CLICKED'
  | 'WEBRTC_INIT_START'
  | 'WEBRTC_CONNECTED'
  | 'REMOTE_AUDIO_ATTACHED'
  | 'REMOTE_VIDEO_ATTACHED';

type TraceEntry = {
  t0: number;
  marks: Map<CallLatencyTag, number>;
};

const traces = new Map<string, TraceEntry>();

function logLine(
  callId: string,
  tag: CallLatencyTag,
  msSinceT0: number,
  deltaMs: number,
  extra?: Record<string, unknown>,
): void {
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(
    `CALL_LATENCY callId=${callId} tag=${tag} ms=${msSinceT0} delta=${deltaMs}${extraStr}`,
  );
}

export function callLatencyStart(callId: string, tag: CallLatencyTag = 'CALL_START_T0'): void {
  if (!callId) return;
  const now = Date.now();
  traces.set(callId, { t0: now, marks: new Map([[tag, now]]) });
  logLine(callId, tag, 0, 0);
}

/** Start trace anchored to an earlier epoch (e.g. FCM server timestamp). */
export function callLatencyStartFromEpoch(
  callId: string,
  epochMs: number,
  tag: CallLatencyTag = 'CALL_START_T0',
): void {
  if (!callId) return;
  const now = Date.now();
  traces.set(callId, { t0: epochMs, marks: new Map([[tag, epochMs]]) });
  const msSinceT0 = now - epochMs;
  logLine(callId, tag, msSinceT0, msSinceT0, { anchored: true });
}

export function callLatencyMark(
  callId: string,
  tag: CallLatencyTag,
  extra?: Record<string, unknown>,
): void {
  if (!callId) return;
  const now = Date.now();
  let entry = traces.get(callId);
  if (!entry) {
    entry = { t0: now, marks: new Map() };
    traces.set(callId, entry);
  }
  const prev = entry.marks.get(tag);
  if (prev != null) return;
  entry.marks.set(tag, now);
  const msSinceT0 = now - entry.t0;
  const sorted = [...entry.marks.entries()].sort((a, b) => a[1] - b[1]);
  const prevMark = sorted.length >= 2 ? sorted[sorted.length - 2][1] : entry.t0;
  logLine(callId, tag, msSinceT0, now - prevMark, extra);
}

export function callLatencyReport(callId: string): Record<string, number> | null {
  const entry = traces.get(callId);
  if (!entry) return null;
  const report: Record<string, number> = {};
  for (const [tag, ts] of entry.marks) {
    report[tag] = ts - entry.t0;
  }
  if (__DEV__) {
    console.log(`CALL_LATENCY_REPORT callId=${callId}`, report);
  }
  return report;
}

export function callLatencyClear(callId: string): void {
  traces.delete(callId);
}
