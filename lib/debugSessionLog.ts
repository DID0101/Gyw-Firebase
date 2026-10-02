/**
 * Debug session 4966a5 — remove after verification.
 */
export function debugSessionLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = 'pre-fix'
) {
  const payload = {
    sessionId: '4966a5',
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  if (__DEV__) {
    console.log('[DBG4966a5]', JSON.stringify(payload));
  }
  // #region agent log
  fetch('http://127.0.0.1:7311/ingest/b306d850-3115-46fd-8aeb-dfa65e8a28d5', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '4966a5',
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // #endregion
}
