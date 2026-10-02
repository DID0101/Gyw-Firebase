/**
 * Production-safe debug logging for Play Store builds.
 * Release builds silence log/warn/info/debug in app/_layout.tsx — only console.error survives.
 * In __DEV__, info-level prodDebug uses console.log so Metro does not show false "ERROR" lines.
 */
export type ProdDebugPayload = Record<string, unknown>;

function safeJson(payload: ProdDebugPayload): string {
  try {
    return JSON.stringify({ ...payload, ts: Date.now() });
  } catch {
    return JSON.stringify({ message: 'Unserializable payload', ts: Date.now() });
  }
}

function emitProdDebug(tag: string, line: string, level: 'info' | 'error'): void {
  const prefix = `[PROD_DEBUG][${tag}]`;
  if (level === 'error' || !__DEV__) {
    // eslint-disable-next-line no-console
    console.error(prefix, line);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(prefix, line);
}

export function prodDebug(tag: string, payload: ProdDebugPayload = {}): void {
  try {
    emitProdDebug(tag, safeJson(payload), 'info');
  } catch {
    emitProdDebug(tag, String(payload), 'info');
  }
}

export function prodDebugError(tag: string, error: unknown, payload: ProdDebugPayload = {}): void {
  const e = error as { code?: string; message?: string; name?: string; stack?: string; details?: unknown };
  const line = safeJson({
    ...payload,
    code: e?.code ?? null,
    name: e?.name ?? null,
    message: error instanceof Error ? error.message : String(error),
    details: e?.details ?? null,
    stack: error instanceof Error ? error.stack?.slice(0, 1200) : undefined,
  });
  emitProdDebug(tag, line, 'error');
}
