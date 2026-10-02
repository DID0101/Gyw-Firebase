/**
 * Profiles expo-image prefetch + large image loads in dev.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { currentHourBucket, getAuditScreen } from '@/lib/debug/networkAudit/auditContext';

type ImageEvent = {
  uri: string;
  screen: string;
  hour: string;
  estBytes: number;
  source: 'prefetch' | 'render' | 'download';
};

const events: ImageEvent[] = [];
const MAX_EVENTS = 500;
let installed = false;

function truncateUri(uri: string): string {
  if (uri.length <= 120) return uri;
  return `${uri.slice(0, 117)}...`;
}

function estimateUriWeight(uri: string): number {
  const lower = uri.toLowerCase();
  if (lower.includes('thumbnail') || lower.includes('thumb')) return 32 * 1024;
  if (lower.includes('.webp')) return 80 * 1024;
  if (lower.includes('firebasestorage') || lower.includes('googleusercontent')) return 200 * 1024;
  return 120 * 1024;
}

function record(source: ImageEvent['source'], uri: string, estBytes?: number): void {
  if (!__DEV__ || !uri) return;
  const evt: ImageEvent = {
    uri: truncateUri(uri),
    screen: getAuditScreen(),
    hour: currentHourBucket(),
    estBytes: estBytes ?? estimateUriWeight(uri),
    source,
  };
  events.push(evt);
  if (events.length > MAX_EVENTS) events.shift();

  DebugLogger.logImage('IMAGE_LOAD', {
    source,
    uri: evt.uri,
    screen: evt.screen,
    est: `${Math.round(evt.estBytes / 1024)} KB`,
    hour: evt.hour,
  });
}

export function installImageCacheProfiler(): void {
  if (!__DEV__ || installed) return;
  installed = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoImage = require('expo-image') as {
      Image?: {
        prefetch?: (urls: string | string[], options?: unknown) => Promise<boolean>;
        loadAsync?: (source: unknown) => Promise<unknown>;
      };
    };
    const Image = expoImage.Image;
    if (Image?.prefetch) {
      const origPrefetch = Image.prefetch.bind(Image);
      Image.prefetch = async (urls: string | string[], options?: unknown) => {
        const list = Array.isArray(urls) ? urls : [urls];
        for (const uri of list) record('prefetch', uri);
        DebugLogger.logImage('IMAGE_PREFETCH_BATCH', {
          count: list.length,
          screen: getAuditScreen(),
        });
        return origPrefetch(urls, options);
      };
    }
    if (Image?.loadAsync) {
      const origLoad = Image.loadAsync.bind(Image);
      Image.loadAsync = async (source: unknown) => {
        const uri =
          typeof source === 'object' && source && 'uri' in source
            ? String((source as { uri?: string }).uri ?? '')
            : typeof source === 'string'
              ? source
              : '';
        if (uri) record('download', uri);
        return origLoad(source);
      };
    }
    DebugLogger.logImage('IMAGE_PROFILER_INSTALLED', {});
  } catch (err) {
    DebugLogger.warnImage('IMAGE_PROFILER_INSTALL_FAILED', { err: String(err) });
  }
}

/** Call from AppImage dev wrapper — optional lightweight render tracking. */
export function recordImageRender(uri: string | undefined, priority?: string): void {
  if (!uri) return;
  record('render', uri);
  if (priority === 'high') {
    DebugLogger.logImage('HIGH_PRIORITY_IMAGE', { uri: truncateUri(uri), screen: getAuditScreen() });
  }
}

export function getImageAuditReport(): {
  totalEvents: number;
  prefetchCount: number;
  estTotalBytes: number;
  byScreen: Record<string, number>;
} {
  let prefetchCount = 0;
  let estTotalBytes = 0;
  const byScreen: Record<string, number> = {};
  for (const e of events) {
    if (e.source === 'prefetch') prefetchCount += 1;
    estTotalBytes += e.estBytes;
    byScreen[e.screen] = (byScreen[e.screen] ?? 0) + e.estBytes;
  }
  return { totalEvents: events.length, prefetchCount, estTotalBytes, byScreen };
}

export function logImageAuditReport(): void {
  if (!__DEV__) return;
  const report = getImageAuditReport();
  DebugLogger.logReport('IMAGE_AUDIT', {
    ...report,
    estTotalMB: (report.estTotalBytes / (1024 * 1024)).toFixed(2),
  });
}
