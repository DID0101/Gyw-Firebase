/**
 * Release-safe startup tracing — uses console.error so logs survive app/_layout.tsx
 * console silencing in production builds.
 *
 * Logcat filter:
 *   adb logcat | findstr /i "GYW_STARTUP STARTUP_STEP"
 */
import { Platform } from 'react-native';

export type StartupStep =
  | 'STEP_1_APP_LAUNCHED'
  | 'STEP_2_FIREBASE_INIT'
  | 'STEP_3_ANALYTICS_INIT'
  | 'STEP_4_CRASHLYTICS_INIT'
  | 'STEP_5_PERFORMANCE_INIT'
  | 'STEP_6_AUTH_INIT'
  | 'STEP_7_FIRESTORE_INIT'
  | 'STEP_8_NAVIGATION_MOUNTED';

type StepPayload = Record<string, unknown>;

const startedAt = Date.now();
const completed = new Set<StartupStep>();

function safeJson(payload: StepPayload): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return '{"serialize":"failed"}';
  }
}

/** Log a startup step (console.error in release for logcat; console.log in dev to avoid LogBox takeover). */
export function logStartupStep(step: StartupStep, payload: StepPayload = {}): void {
  completed.add(step);
  const line = `[GYW_STARTUP][${step}] +${Date.now() - startedAt}ms ${safeJson({
    platform: Platform.OS,
    __DEV__,
    ...payload,
  })}`;
  // eslint-disable-next-line no-console
  (__DEV__ ? console.log : console.error)(line);
}

export function logStartupFail(step: StartupStep, error: unknown, extra: StepPayload = {}): void {
  const e = error as { message?: string; code?: string; name?: string; stack?: string };
  const line = `[GYW_STARTUP][${step}_FAIL] +${Date.now() - startedAt}ms ${safeJson({
    platform: Platform.OS,
    __DEV__,
    message: error instanceof Error ? error.message : String(error),
    code: e?.code ?? null,
    name: e?.name ?? null,
    stack: error instanceof Error ? error.stack?.slice(0, 1200) : undefined,
    ...extra,
  })}`;
  // eslint-disable-next-line no-console
  (__DEV__ ? console.warn : console.error)(line);
}

/** Verify a native module exists before use (release crash bisect). */
export function verifyNativeModule(name: string): boolean {
  try {
    const { NativeModules } = require('react-native') as typeof import('react-native');
    const mod = NativeModules[name];
    const ok = mod != null;
    logStartupStep('STEP_1_APP_LAUNCHED', {
      nativeModule: name,
      present: ok,
      keys: ok && typeof mod === 'object' ? Object.keys(mod as object).slice(0, 12) : [],
    });
    return ok;
  } catch (e) {
    logStartupFail('STEP_1_APP_LAUNCHED', e, { nativeModule: name });
    return false;
  }
}

const FIREBASE_NATIVE_MODULES = [
  'RNFBAppModule',
  'RNFBAuthModule',
  'RNFBFirestoreModule',
  'RNFBCrashlyticsModule',
  'RNFBPerfModule',
  'RNFBAnalyticsModule',
] as const;

/** Log presence of RN Firebase native bridges before JS monitoring init. */
export function verifyFirebaseNativeModules(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const name of FIREBASE_NATIVE_MODULES) {
    result[name] = verifyNativeModule(name);
  }
  logStartupStep('STEP_2_FIREBASE_INIT', { phase: 'native_modules', modules: result });
  return result;
}

export function installReleaseGlobalHandlers(): void {
  try {
    const g = globalThis as {
      ErrorUtils?: {
        getGlobalHandler?: () => (e: unknown, fatal: boolean) => void;
        setGlobalHandler?: (h: (e: unknown, fatal: boolean) => void) => void;
      };
      onunhandledrejection?: (e: PromiseRejectionEvent) => void;
      HermesInternal?: unknown;
    };

    logStartupStep('STEP_1_APP_LAUNCHED', {
      hermes: !!g.HermesInternal,
      handlers: 'installing',
    });

    if (g.ErrorUtils?.setGlobalHandler && typeof g.ErrorUtils.getGlobalHandler === 'function') {
      const prev = g.ErrorUtils.getGlobalHandler();
      g.ErrorUtils.setGlobalHandler((error: unknown, isFatal: boolean) => {
        logStartupFail(isFatal ? 'STEP_8_NAVIGATION_MOUNTED' : 'STEP_2_FIREBASE_INIT', error, {
          fatal: isFatal,
          source: 'global_error_handler',
        });
        prev?.(error, isFatal);
      });
    }

    const onRejection = (event: PromiseRejectionEvent | { reason?: unknown }) => {
      const reason = 'reason' in event ? event.reason : event;
      logStartupFail('STEP_2_FIREBASE_INIT', reason, { source: 'unhandled_promise_rejection' });
    };

    if (typeof g.addEventListener === 'function') {
      g.addEventListener('unhandledrejection', onRejection as (e: PromiseRejectionEvent) => void);
    }
  } catch (e) {
    logStartupFail('STEP_1_APP_LAUNCHED', e, { source: 'installReleaseGlobalHandlers' });
  }
}

export function getCompletedStartupSteps(): StartupStep[] {
  return [...completed];
}
