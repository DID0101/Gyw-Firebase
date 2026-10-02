/**
 * Dev-only touch trace for chat list rows.
 * Metro: filter `CHAT_ROW_TOUCH` to see tap vs long-press ordering and JS gaps.
 */

let lastEventAt = 0;

function nowMs(): number {
  const p =
    typeof globalThis !== 'undefined'
      ? (globalThis as { performance?: { now?: () => number } }).performance
      : undefined;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

export type ChatRowTouchEvent =
  | 'PRESS_START'
  | 'PRESS_END'
  | 'ON_PRESS'
  | 'ON_LONG_PRESS'
  | 'NAVIGATE_CHAT'
  | 'LONG_PRESS_SUPPRESSED_TAP';

export function chatRowTouchLog(event: ChatRowTouchEvent, chatId: string, extra?: string) {
  if (!__DEV__) return;
  const t = nowMs();
  const sinceLast = lastEventAt > 0 ? Math.round(t - lastEventAt) : 0;
  lastEventAt = t;
  const tail = extra ? ` ${extra}` : '';
  console.log(
    `CHAT_ROW_TOUCH chatId=${chatId} event=${event} t=${t.toFixed(1)} sinceLastMs=${sinceLast}${tail}`
  );
}

/** Log when a synchronous JS stretch may have blocked touch handling. */
export function chatRowTouchWarnJsStall(label: string, durationMs: number) {
  if (!__DEV__ || durationMs < 16) return;
  console.log(`CHAT_ROW_TOUCH JS_STALL label=${label} durationMs=${Math.round(durationMs)}`);
}
