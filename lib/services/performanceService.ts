/**
 * Firebase Performance Monitoring — custom traces for chat UX flows.
 */
import { Platform } from 'react-native';

import { hasRnFirebase } from '@/lib/rnFirebase';
import { markAppStart, markAppStartFail } from '@/lib/debug/appStartupMarkers';

export type PerformanceTraceName =
  | 'app_startup'
  | 'chat_list_load'
  | 'chat_room_load'
  | 'send_message'
  | 'sync_messages'
  | 'profile_load';

export type PerformanceTraceHandle = {
  name: PerformanceTraceName;
  putAttribute: (key: string, value: string) => void;
  stop: (attrs?: Record<string, string>) => Promise<void>;
};

type PerfTrace = {
  start: () => Promise<null>;
  stop: () => Promise<null>;
  putAttribute: (key: string, value: string) => void;
};

type PerfModule = {
  getPerformance: () => unknown;
  trace: (perf: unknown, name: string) => PerfTrace;
};

const activeTraces = new Map<string, PerfTrace>();
let perfMod: PerfModule | null = null;
let perfInstance: unknown = null;
let appStartupTrace: PerformanceTraceHandle | null = null;

function getPerf(): { mod: PerfModule; instance: unknown } | null {
  if (Platform.OS === 'web' || !hasRnFirebase) return null;
  if (!perfMod) {
    try {
      perfMod = require('@react-native-firebase/perf') as PerfModule;
      perfInstance = perfMod.getPerformance();
    } catch {
      perfMod = null;
      perfInstance = null;
    }
  }
  if (!perfMod || !perfInstance) return null;
  return { mod: perfMod, instance: perfInstance };
}

const noopHandle = (name: PerformanceTraceName): PerformanceTraceHandle => ({
  name,
  putAttribute: () => {},
  stop: async () => {},
});

/**
 * Start a named custom trace. Returns a handle to stop it later.
 * Only one trace per name can be active at a time; starting again stops the prior trace.
 */
export async function startPerformanceTrace(name: PerformanceTraceName): Promise<PerformanceTraceHandle> {
  const perf = getPerf();
  if (!perf) return noopHandle(name);

  const existing = activeTraces.get(name);
  if (existing) {
    try {
      await existing.stop();
    } catch {
      /* non-fatal */
    }
    activeTraces.delete(name);
  }

  try {
    const traceInstance = perf.mod.trace(perf.instance, name);
    await traceInstance.start();
    activeTraces.set(name, traceInstance);

    return {
      name,
      putAttribute: (key, value) => {
        try {
          traceInstance.putAttribute(key, value);
        } catch {
          /* non-fatal */
        }
      },
      stop: async (attrs) => {
        try {
          if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
              traceInstance.putAttribute(key, value);
            }
          }
          await traceInstance.stop();
        } catch {
          /* non-fatal */
        } finally {
          activeTraces.delete(name);
        }
      },
    };
  } catch {
    return noopHandle(name);
  }
}

/** App startup trace — started in appInit, stopped after first frame/interaction. */
export function markAppStartupTraceStart(): void {
  if (appStartupTrace) return;
  try {
    markAppStart(5);
  } catch (e) {
    markAppStartFail(5, e);
  }
  void startPerformanceTrace('app_startup').then((handle) => {
    appStartupTrace = handle;
  });
}

export async function markAppStartupTraceEnd(): Promise<void> {
  if (!appStartupTrace) return;
  await appStartupTrace.stop();
  appStartupTrace = null;
}

export async function stopPerformanceTrace(
  name: PerformanceTraceName,
  attrs?: Record<string, string>
): Promise<void> {
  const trace = activeTraces.get(name);
  if (!trace) return;
  try {
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        trace.putAttribute(key, value);
      }
    }
    await trace.stop();
  } catch {
    /* non-fatal */
  } finally {
    activeTraces.delete(name);
  }
}
