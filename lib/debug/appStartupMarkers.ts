/**
 * APP_START_1 … APP_START_10 — release-safe startup bisect markers.
 *
 * console.log is silenced in production (app/_layout.tsx); every marker is also
 * emitted via console.error so adb logcat shows them on release APKs.
 *
 * Filter: adb logcat | findstr /i "APP_START"
 */

export type AppStartStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const LABELS: Record<AppStartStep, string> = {
  1: 'app_entry',
  2: 'firebase_app',
  3: 'analytics',
  4: 'crashlytics',
  5: 'performance',
  6: 'auth',
  7: 'firestore',
  8: 'navigation_mount',
  9: 'chats_screen_mount',
  10: 'firestore_listener_attach',
};

let handlersInstalled = false;

function safeExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return '';
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ' {"serialize":"failed"}';
  }
}

/** Log APP_START_N (try/catch wrapped per investigation spec). */
export function markAppStart(step: AppStartStep, extra?: Record<string, unknown>): void {
  const tag = `APP_START_${step}`;
  try {
    const suffix = safeExtra({ phase: LABELS[step], ...extra });
    const line = tag + suffix;
    // eslint-disable-next-line no-console
    console.log(line);
    if (!__DEV__) {
      // eslint-disable-next-line no-console
      console.error(line);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    (__DEV__ ? console.warn : console.error)(`${tag}_FAILED`, e);
  }
}

export function markAppStartFail(
  step: AppStartStep,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const tag = `APP_START_${step}_FAILED`;
  const e = error as { message?: string; stack?: string };
  // eslint-disable-next-line no-console
  console.error(tag, {
    phase: LABELS[step],
    message: error instanceof Error ? error.message : String(error),
    stack: e?.stack?.slice(0, 1200),
    ...extra,
  });
}

function logException(source: string, error: unknown, extra?: Record<string, unknown>): void {
  const e = error as { message?: string; stack?: string };
  // eslint-disable-next-line no-console
  console.error(source, {
    message: error instanceof Error ? error.message : String(error),
    stack: e?.stack?.slice(0, 1200),
    ...extra,
  });
}

/** Global JS fatal + unhandled promise rejection logging. Call once from index.js. */
export function installAppStartGlobalHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  try {
    const g = globalThis as {
      ErrorUtils?: {
        getGlobalHandler?: () => (err: unknown, fatal: boolean) => void;
        setGlobalHandler?: (h: (err: unknown, fatal: boolean) => void) => void;
      };
      HermesInternal?: unknown;
      addEventListener?: (type: string, handler: (ev: unknown) => void) => void;
    };

    if (g.ErrorUtils?.setGlobalHandler && typeof g.ErrorUtils.getGlobalHandler === 'function') {
      const prev = g.ErrorUtils.getGlobalHandler();
      g.ErrorUtils.setGlobalHandler((error: unknown, isFatal: boolean) => {
        logException('APP_START_EXCEPTION', error, { fatal: isFatal });
        prev?.(error, isFatal);
      });
    }

    const onRejection = (event: { reason?: unknown } | unknown) => {
      const reason =
        event && typeof event === 'object' && 'reason' in event
          ? (event as { reason?: unknown }).reason
          : event;
      logException('APP_START_UNHANDLED_REJECTION', reason);
    };

    if (typeof g.addEventListener === 'function') {
      g.addEventListener('unhandledrejection', onRejection);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('APP_START_GLOBAL_HANDLERS_FAILED', e);
  }
}
