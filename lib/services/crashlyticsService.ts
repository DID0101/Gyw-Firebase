/**
 * Firebase Crashlytics — native iOS/Android only (Expo dev client / prebuild).
 * No-ops on web so existing Firebase Auth / Firestore web paths stay untouched.
 */
import { Platform } from 'react-native';

import { hasRnFirebase } from '@/lib/rnFirebase';
import { markAppStart, markAppStartFail } from '@/lib/debug/appStartupMarkers';

type CrashlyticsModule = {
  getCrashlytics: () => unknown;
  setCrashlyticsCollectionEnabled: (crashlytics: unknown, enabled: boolean) => Promise<null>;
  log: (crashlytics: unknown, message: string) => void;
  recordError: (crashlytics: unknown, error: Error, jsErrorName?: string) => void;
  setUserId: (crashlytics: unknown, userId: string) => Promise<null>;
  setAttribute: (crashlytics: unknown, name: string, value: string) => Promise<null>;
};

let crashlyticsMod: CrashlyticsModule | null = null;
let crashlyticsInstance: unknown = null;
let initialized = false;

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

function getCrashlyticsInstance(): unknown | null {
  if (Platform.OS === 'web' || !hasRnFirebase) return null;
  if (!crashlyticsMod) {
    try {
      crashlyticsMod = require('@react-native-firebase/crashlytics') as CrashlyticsModule;
      crashlyticsInstance = crashlyticsMod.getCrashlytics();
    } catch {
      crashlyticsMod = null;
      crashlyticsInstance = null;
    }
  }
  return crashlyticsInstance;
}

/** Enable collection and wire global JS error hooks. Call once at app startup. */
export function initCrashlytics(): void {
  if (initialized || Platform.OS === 'web' || !hasRnFirebase) return;
  initialized = true;

  try {
    markAppStart(4);
  } catch (e) {
    markAppStartFail(4, e);
  }

  const instance = getCrashlyticsInstance();
  if (!instance || !crashlyticsMod) return;

  void crashlyticsMod.setCrashlyticsCollectionEnabled(instance, true);

  try {
    const ErrorUtilsAny = (globalThis as { ErrorUtils?: { getGlobalHandler?: () => (e: unknown, fatal: boolean) => void; setGlobalHandler?: (h: (e: unknown, fatal: boolean) => void) => void } }).ErrorUtils;
    if (ErrorUtilsAny?.setGlobalHandler && typeof ErrorUtilsAny.getGlobalHandler === 'function') {
      const prev = ErrorUtilsAny.getGlobalHandler();
      ErrorUtilsAny.setGlobalHandler((error: unknown, isFatal: boolean) => {
        try {
          if (isFatal) {
            logError(error);
          } else {
            logNonFatal(error);
          }
        } catch {
          /* non-fatal */
        }
        prev?.(error, isFatal);
      });
    }
  } catch {
    /* non-fatal */
  }

  try {
    const rejectionHandler = (event: PromiseRejectionEvent | { reason?: unknown }) => {
      const reason = 'reason' in event ? event.reason : event;
      logNonFatal(reason);
    };
    if (typeof globalThis !== 'undefined' && 'addEventListener' in globalThis) {
      (globalThis as typeof globalThis & { addEventListener: (t: string, h: (e: PromiseRejectionEvent) => void) => void }).addEventListener(
        'unhandledrejection',
        rejectionHandler as (e: PromiseRejectionEvent) => void
      );
    }
  } catch {
    /* non-fatal */
  }
}

/** Record a fatal JS error. */
export function logError(error: unknown): void {
  const instance = getCrashlyticsInstance();
  if (!instance || !crashlyticsMod) return;
  try {
    crashlyticsMod.recordError(instance, normalizeError(error), 'js_fatal');
  } catch {
    /* non-fatal */
  }
}

/** Record a non-fatal JS error. */
export function logNonFatal(error: unknown): void {
  const instance = getCrashlyticsInstance();
  if (!instance || !crashlyticsMod) return;
  try {
    crashlyticsMod.recordError(instance, normalizeError(error), 'js_non_fatal');
  } catch {
    /* non-fatal */
  }
}

/** Attach or clear the signed-in user id. */
export function setCrashlyticsUser(userId: string | null | undefined): void {
  const instance = getCrashlyticsInstance();
  if (!instance || !crashlyticsMod) return;
  try {
    void crashlyticsMod.setUserId(instance, userId ?? '');
  } catch {
    /* non-fatal */
  }
}

/** Breadcrumb-style custom log (not an Analytics event). */
export function crashlyticsLog(message: string): void {
  const instance = getCrashlyticsInstance();
  if (!instance || !crashlyticsMod) return;
  try {
    crashlyticsMod.log(instance, message);
  } catch {
    /* non-fatal */
  }
}

export function crashlyticsSetAttribute(name: string, value: string): void {
  const instance = getCrashlyticsInstance();
  if (!instance || !crashlyticsMod) return;
  try {
    void crashlyticsMod.setAttribute(instance, name, value);
  } catch {
    /* non-fatal */
  }
}
