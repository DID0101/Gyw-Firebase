import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { prodDebug, prodDebugError, type ProdDebugPayload } from '@/lib/debug/prodDebug';

type AuthRuntimeState = {
  ready: boolean;
  uid: string | null;
  provider: string | null;
  tokenAvailable: boolean | 'checking' | null;
};

type RuntimeEventState = {
  appStartMs: number;
  firebaseReady: boolean;
  firebaseProvider: string | null;
  auth: AuthRuntimeState;
};

type HangWatch = {
  screen: string;
  startedAt: number;
  lastSuccessfulEvent?: string;
  lastFailedEvent?: string;
  timer: ReturnType<typeof setTimeout>;
};

const runtimeState: RuntimeEventState = {
  appStartMs: Date.now(),
  firebaseReady: false,
  firebaseProvider: null,
  auth: {
    ready: false,
    uid: null,
    provider: null,
    tokenAvailable: null,
  },
};

const hangWatches = new Map<string, HangWatch>();
const readyListeners = new Set<() => void>();

function elapsedFromAppStart(): number {
  return Date.now() - runtimeState.appStartMs;
}

function loadUpdatesMetadata(): Record<string, unknown> {
  // Never require('expo-updates') here — it is not a direct dependency; the package
  // registers async listeners that lazy-require submodules missing from Hermes release
  // bundles (fatal: Requiring unknown module "2618" in getExpoUpdatesExports).
  // OTA updates are disabled in app.json (EXPO_UPDATES_ENABLED=false).
  return {
    updateId: null,
    runtimeVersion: Constants.expoConfig?.runtimeVersion ?? null,
    channel: null,
    updateCreatedAt: null,
    isEmbeddedLaunch: null,
  };
}

export function logBuildInfo(): void {
  const expoConfig = Constants.expoConfig;
  const updates = loadUpdatesMetadata();
  prodDebug('BUILD_INFO', {
    versionCode: Constants.nativeBuildVersion ?? expoConfig?.android?.versionCode ?? null,
    versionName: Constants.nativeAppVersion ?? expoConfig?.version ?? null,
    bundleId:
      Platform.OS === 'android'
        ? expoConfig?.android?.package ?? null
        : expoConfig?.ios?.bundleIdentifier ?? null,
    appOwnership: Constants.appOwnership ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    jsBundleHash: updates.updateId ?? null,
    platform: Platform.OS,
    __DEV__,
    ...updates,
  });
}

export function markFirebaseInit(event: string, payload: ProdDebugPayload = {}): void {
  if (event === 'FIREBASE_READY') {
    runtimeState.firebaseReady = true;
    runtimeState.firebaseProvider = typeof payload.provider === 'string' ? payload.provider : runtimeState.firebaseProvider;
    readyListeners.forEach((listener) => listener());
  }
  prodDebug('FIREBASE_INIT', {
    event,
    elapsedFromAppStartMs: elapsedFromAppStart(),
    firebaseReady: runtimeState.firebaseReady,
    firebaseProvider: runtimeState.firebaseProvider,
    ...payload,
  });
}

export function setAuthRuntimeState(next: Partial<AuthRuntimeState>): void {
  runtimeState.auth = {
    ...runtimeState.auth,
    ...next,
  };
  readyListeners.forEach((listener) => listener());
}

export function logAuthState(event: string, payload: ProdDebugPayload = {}): void {
  prodDebug('AUTH_STATE', {
    event,
    elapsedFromAppStartMs: elapsedFromAppStart(),
    authReady: runtimeState.auth.ready,
    uid: runtimeState.auth.uid,
    provider: runtimeState.auth.provider,
    tokenAvailable: runtimeState.auth.tokenAvailable,
    ...payload,
  });
}

export function getRuntimeQueryState(): {
  firebaseReady: boolean;
  firebaseProvider: string | null;
  authReady: boolean;
  authUid: string | null;
  authProvider: string | null;
  tokenAvailable: boolean | 'checking' | null;
} {
  return {
    firebaseReady: runtimeState.firebaseReady,
    firebaseProvider: runtimeState.firebaseProvider,
    authReady: runtimeState.auth.ready,
    authUid: runtimeState.auth.uid,
    authProvider: runtimeState.auth.provider,
    tokenAvailable: runtimeState.auth.tokenAvailable,
  };
}

export function onRuntimeReadyStateChange(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

export function hasRuntimeReadyForQueries(): boolean {
  return runtimeState.firebaseReady && runtimeState.auth.ready && !!runtimeState.auth.uid;
}

export async function waitForRuntimeReadyForQueries(timeoutMs = 5_000): Promise<boolean> {
  if (hasRuntimeReadyForQueries()) return true;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(hasRuntimeReadyForQueries());
    }, timeoutMs);
    const cleanupFns: Array<() => void> = [];
    const check = () => {
      if (!hasRuntimeReadyForQueries()) return;
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      cleanupFns.forEach((fn) => fn());
    };
    cleanupFns.push(onRuntimeReadyStateChange(check));
  });
}

export function logScreenLifecycle(screen: string, event: string, payload: ProdDebugPayload = {}): void {
  prodDebug('SCREEN_LIFECYCLE', {
    screen,
    event,
    elapsedFromAppStartMs: elapsedFromAppStart(),
    ...payload,
  });
}

export function logFirestoreQuery(payload: {
  collection: string;
  where?: unknown;
  event: string;
  expectedResultCount?: unknown;
  actualResultCount?: number | null;
  permissionError?: unknown;
  screen?: string;
  op?: string;
  provider?: string;
  startedAtMs?: number;
  extra?: ProdDebugPayload;
}): void {
  const isRoutineEmptyBatch =
    (payload.event === 'GET_START' || payload.event === 'GET_RESULT') &&
    !payload.permissionError &&
    (payload.actualResultCount == null || payload.actualResultCount === 0);
  if (isRoutineEmptyBatch) return;

  const runtime = getRuntimeQueryState();
  prodDebug('FIRESTORE_QUERY', {
    collection: payload.collection,
    where: payload.where ?? null,
    event: payload.event,
    op: payload.op ?? null,
    provider: payload.provider ?? null,
    screen: payload.screen ?? null,
    expectedResultCount: payload.expectedResultCount ?? 'unknown',
    actualResultCount: payload.actualResultCount ?? null,
    permissionError: payload.permissionError ?? null,
    elapsedFromQueryStartMs: payload.startedAtMs ? Date.now() - payload.startedAtMs : null,
    firebaseReady: runtime.firebaseReady,
    firebaseProvider: runtime.firebaseProvider,
    authReady: runtime.authReady,
    authUid: runtime.authUid,
    authProvider: runtime.authProvider,
    tokenAvailable: runtime.tokenAvailable,
    ...payload.extra,
  });
}

export function startHangWatch(
  key: string,
  screen: string,
  payload: {
    lastSuccessfulEvent?: string;
    lastFailedEvent?: string;
    timeoutMs?: number;
  } = {},
): void {
  if (hangWatches.has(key)) return;
  const startedAt = Date.now();
  const timeoutMs = payload.timeoutMs ?? 8_000;
  const timer = setTimeout(() => {
    const watch = hangWatches.get(key);
    if (!watch) return;
    prodDebug('HANG_DETECTED', {
      screen: watch.screen,
      key,
      reason: 'loading_timeout',
      lastSuccessfulEvent: watch.lastSuccessfulEvent ?? null,
      lastFailedEvent: watch.lastFailedEvent ?? null,
      timeStuckMs: Date.now() - watch.startedAt,
    });
  }, timeoutMs);

  hangWatches.set(key, {
    screen,
    startedAt,
    lastSuccessfulEvent: payload.lastSuccessfulEvent,
    lastFailedEvent: payload.lastFailedEvent,
    timer,
  });
}

export function updateHangWatch(
  key: string,
  payload: {
    lastSuccessfulEvent?: string;
    lastFailedEvent?: string;
  },
): void {
  const watch = hangWatches.get(key);
  if (!watch) return;
  hangWatches.set(key, {
    ...watch,
    ...payload,
  });
}

export function endHangWatch(key: string, reason: string): void {
  const watch = hangWatches.get(key);
  if (!watch) return;
  clearTimeout(watch.timer);
  prodDebug('SCREEN_LIFECYCLE', {
    screen: watch.screen,
    event: 'HANG_WATCH_END',
    key,
    reason,
    timeStuckMs: Date.now() - watch.startedAt,
  });
  hangWatches.delete(key);
}

export function logSilentEmptyState(
  _screen: string,
  _payload: {
    collection?: string;
    where?: unknown;
    lastSuccessfulEvent?: string;
    lastFailedEvent?: string;
  } = {},
): void {
  // Empty Firestore batches are expected during contact matching — not an error.
}

export function logRuntimeError(tag: string, error: unknown, payload: ProdDebugPayload = {}): void {
  prodDebugError(tag, error, {
    elapsedFromAppStartMs: elapsedFromAppStart(),
    ...payload,
  });
}
