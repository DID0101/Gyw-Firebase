import { useCallManager } from '@/lib/hooks/useCallManager';

/**
 * Mount once under authenticated `(home)` so CallKeep + foreground FCM stay registered
 * for the whole session. Avoids mounting `useCallManager` inside `call/incoming`, which
 * caused teardown/remount churn and duplicate native subscriptions when that screen opened.
 */
export function CallManagerHost() {
  useCallManager();
  return null;
}
