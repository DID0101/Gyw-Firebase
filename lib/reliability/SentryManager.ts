/**
 * Sentry — global error capture with network/user/screen context.
 */
import type { ComponentType } from 'react';
import { Platform } from 'react-native';

import { getNetworkState } from '@/lib/reliability/NetworkManager';
import { logReliabilityError, logSentry } from '@/lib/reliability/reliabilityLog';

type SentryModule = typeof import('@sentry/react-native');

let sentry: SentryModule | null = null;
let initialized = false;

function getDsn(): string | undefined {
  return (
    process.env.EXPO_PUBLIC_SENTRY_DSN ??
    process.env.SENTRY_DSN ??
  'https://58904c847c4a7b07ade486dc8db51212@o4511545311821824.ingest.de.sentry.io/4511545314836560'
  );
}

export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = getDsn();
  if (!dsn) {
    if (__DEV__) {
      console.log('[SENTRY] skipped — no EXPO_PUBLIC_SENTRY_DSN');
    }
    return;
  }
  try {
    sentry = require('@sentry/react-native') as SentryModule;
    sentry.init({
      dsn,
      enabled: !__DEV__,
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
      attachStacktrace: true,
      environment: __DEV__ ? 'development' : 'production',
      // Do NOT enable mobileReplayIntegration here — it breaks Hermes release bundles
      // with "Requiring unknown module" at index (inlineRequires + lazy replay chunks).
    });
    logSentry('INIT_OK', { platform: Platform.OS });
  } catch (e) {
    if (__DEV__) console.warn('[SENTRY] init failed', e);
  }
}

export function refreshSentryNetworkContext(): void {
  if (!sentry) return;
  const n = getNetworkState();
  sentry.setContext('network', {
    isOnline: n.isOnline,
    connectionType: n.connectionType,
    isPoorConnection: n.isPoorConnection,
    isSlow: n.isSlow,
  });
  sentry.setTag('network.online', String(n.isOnline));
  sentry.setTag('network.poor', String(n.isPoorConnection));
}

export function setSentryUser(userId: string | null): void {
  if (!sentry) return;
  if (userId) {
    sentry.setUser({ id: userId });
    sentry.setTag('userId', userId.slice(0, 8));
  } else {
    sentry.setUser(null);
  }
}

export function setSentryScreen(screenName: string): void {
  if (!sentry) return;
  sentry.setTag('screen', screenName);
  sentry.addBreadcrumb({ category: 'navigation', message: screenName, level: 'info' });
}

export type ReliabilityErrorCategory =
  | 'signup'
  | 'firestore'
  | 'upload'
  | 'retry'
  | 'queue'
  | 'auth'
  | 'network';

export function captureReliabilityError(
  category: ReliabilityErrorCategory,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  logReliabilityError(
    category === 'firestore' ? 'FIRESTORE' : category === 'upload' ? 'UPLOAD' : 'AUTH',
    `${category.toUpperCase()}_ERROR`,
    error,
    extra
  );
  if (!sentry) return;
  refreshSentryNetworkContext();
  sentry.withScope((scope) => {
    scope.setTag('reliability.category', category);
    if (extra) scope.setExtras(extra);
    if (error instanceof Error) sentry!.captureException(error);
    else sentry!.captureMessage(String(error));
  });
}

export function wrapRootComponent<P extends Record<string, unknown>>(
  component: ComponentType<P>
): ComponentType<P> {
  if (!sentry) return component;
  return sentry.wrap(component) as ComponentType<P>;
}
