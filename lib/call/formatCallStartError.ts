import i18n from 'i18next';

/** User-facing message when outgoing call setup fails. */
export function formatCallStartError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  if (
    lower.includes('8081') ||
    lower.includes('failed to connect') ||
    lower.includes('could not connect to development server') ||
    lower.includes('unable to load script')
  ) {
    return i18n.t('calls.devServerUnreachable');
  }
  return i18n.t('calls.failedToInitiate');
}
