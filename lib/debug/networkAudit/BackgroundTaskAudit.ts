/**
 * Logs headless / background task registration and execution (dev only).
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { getAuditScreen } from '@/lib/debug/networkAudit/auditContext';

let installed = false;

export function installBackgroundTaskAudit(): void {
  if (!__DEV__ || installed) return;
  installed = true;

  try {
    const { AppRegistry } = require('react-native') as typeof import('react-native');
    const originalRegister = AppRegistry.registerHeadlessTask?.bind(AppRegistry);
    if (originalRegister) {
      AppRegistry.registerHeadlessTask = (taskKey: string, taskProvider: () => unknown) => {
        DebugLogger.logTimer('HEADLESS_TASK_REGISTERED', { taskKey });
        return originalRegister(taskKey, () => {
          const inner = taskProvider();
          if (typeof inner !== 'function') return inner;
          return async (...args: unknown[]) => {
            DebugLogger.logTimer('HEADLESS_TASK_START', { taskKey, screen: getAuditScreen() });
            try {
              return await (inner as (...a: unknown[]) => Promise<unknown>)(...args);
            } finally {
              DebugLogger.logTimer('HEADLESS_TASK_END', { taskKey });
            }
          };
        });
      };
    }
  } catch (err) {
    DebugLogger.warnTimer('HEADLESS_TASK_AUDIT_FAILED', { err: String(err) });
  }

  try {
    // Optional — only if expo-task-manager is installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const taskManager = require('expo-task-manager') as {
      defineTask?: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => void;
    };
    const originalDefine = taskManager.defineTask;
    if (typeof originalDefine === 'function') {
      taskManager.defineTask = (name: string, fn: (...args: unknown[]) => Promise<unknown>) => {
        DebugLogger.logTimer('EXPO_TASK_DEFINED', { name });
        return originalDefine(name, async (...args: unknown[]) => {
          DebugLogger.logTimer('EXPO_TASK_RUN', { name });
          return fn(...args);
        });
      };
    }
  } catch {
    /* expo-task-manager not installed */
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bgFetch = require('react-native-background-fetch') as {
      configure?: (opts: Record<string, unknown>, onEvent: (id: string) => void, onTimeout: (id: string) => void) => void;
    };
    if (typeof bgFetch.configure === 'function') {
      const originalConfigure = bgFetch.configure.bind(bgFetch);
      bgFetch.configure = (
        opts: Record<string, unknown>,
        onEvent: (id: string) => void,
        onTimeout: (id: string) => void,
      ) => {
        DebugLogger.logTimer('BACKGROUND_FETCH_CONFIGURED', {
          minimumFetchInterval: opts.minimumFetchInterval,
        });
        return originalConfigure(
          opts,
          (id: string) => {
            DebugLogger.logTimer('BACKGROUND_FETCH_EVENT', { id });
            onEvent(id);
          },
          (id: string) => {
            DebugLogger.logTimer('BACKGROUND_FETCH_TIMEOUT', { id });
            onTimeout(id);
          },
        );
      };
    }
  } catch {
    /* react-native-background-fetch not installed */
  }

  DebugLogger.logTimer('BACKGROUND_TASK_AUDIT_INSTALLED', {});
}
