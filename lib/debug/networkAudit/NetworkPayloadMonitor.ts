/**
 * Intercepts global fetch — logs request/response payload sizes grouped by hour + screen.
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { currentHourBucket, getAuditScreen } from '@/lib/debug/networkAudit/auditContext';

type BucketKey = string;

type RequestAggregate = {
  count: number;
  requestBytes: number;
  responseBytes: number;
  errors: number;
};

const hourlyByUrl = new Map<BucketKey, Map<string, RequestAggregate>>();
const hourlyByScreen = new Map<BucketKey, Map<string, RequestAggregate>>();

let originalFetch: typeof fetch | null = null;
let installed = false;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function estimateBodyBytes(body: unknown): number {
  if (body == null) return 0;
  if (typeof body === 'string') return body.length;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return 512;
  try {
    return JSON.stringify(body).length;
  } catch {
    return 256;
  }
}

const LARGE_PAYLOAD_BYTES = 512 * 1024;

function isFirestoreChannelUrl(url: string): boolean {
  return (
    url.includes('firestore.googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('google.firestore.v1.Firestore')
  );
}
function normalizeUrl(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const u = new URL(raw);
    if (u.hostname.includes('firestore.googleapis.com')) return 'firestore.googleapis.com/*';
    if (u.hostname.includes('firebaseio.com')) return 'firebaseio.com/*';
    if (u.hostname.includes('googleapis.com')) return `${u.hostname}${u.pathname.split('/').slice(0, 3).join('/')}`;
    return `${u.hostname}${u.pathname}`;
  } catch {
    return raw.slice(0, 120);
  }
}

function bump(map: Map<string, RequestAggregate>, key: string, reqBytes: number, resBytes: number, isError: boolean): void {
  const cur = map.get(key) ?? { count: 0, requestBytes: 0, responseBytes: 0, errors: 0 };
  cur.count += 1;
  cur.requestBytes += reqBytes;
  cur.responseBytes += resBytes;
  if (isError) cur.errors += 1;
  map.set(key, cur);
}

function recordRequest(url: string, reqBytes: number, resBytes: number, isError: boolean): void {
  const hour = currentHourBucket();
  const screen = getAuditScreen();

  if (!hourlyByUrl.has(hour)) hourlyByUrl.set(hour, new Map());
  if (!hourlyByScreen.has(hour)) hourlyByScreen.set(hour, new Map());

  bump(hourlyByUrl.get(hour)!, url, reqBytes, resBytes, isError);
  bump(hourlyByScreen.get(hour)!, screen, reqBytes, resBytes, isError);

  DebugLogger.logNetwork('FETCH', {
    url,
    screen,
    hour,
    req: formatBytes(reqBytes),
    res: formatBytes(resBytes),
    total: formatBytes(reqBytes + resBytes),
    isError,
    firestoreChannel: isFirestoreChannelUrl(url),
  });

  const totalBytes = reqBytes + resBytes;
  if (totalBytes >= LARGE_PAYLOAD_BYTES) {
    DebugLogger.warnNetwork('LARGE_PAYLOAD', {
      url,
      screen,
      total: formatBytes(totalBytes),
      message: 'Single request/response exceeded 512 KB — investigate while idle',
    });
  }
}

async function readResponseBytes(response: Response): Promise<number> {
  try {
    const clone = response.clone();
    const buf = await clone.arrayBuffer();
    return buf.byteLength;
  } catch {
    const len = response.headers.get('content-length');
    return len ? parseInt(len, 10) || 0 : 0;
  }
}

export function installFetchMonitor(): void {
  if (!__DEV__ || installed || typeof globalThis.fetch !== 'function') return;
  originalFetch = globalThis.fetch.bind(globalThis);
  installed = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = normalizeUrl(input);
    const reqBytes =
      estimateBodyBytes(init?.body) +
      (init?.headers ? JSON.stringify(init.headers).length : 0);

    try {
      const response = await originalFetch!(input, init);
      const resBytes = await readResponseBytes(response);
      recordRequest(url, reqBytes, resBytes, !response.ok);
      return response;
    } catch (err) {
      recordRequest(url, reqBytes, 0, true);
      throw err;
    }
  }) as typeof fetch;

  DebugLogger.logNetwork('FETCH_MONITOR_INSTALLED', {});
}

export function uninstallFetchMonitor(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
    installed = false;
  }
}

export function getNetworkPayloadReport(): {
  byHourUrl: Record<string, Record<string, RequestAggregate>>;
  byHourScreen: Record<string, Record<string, RequestAggregate>>;
} {
  const byHourUrl: Record<string, Record<string, RequestAggregate>> = {};
  const byHourScreen: Record<string, Record<string, RequestAggregate>> = {};

  for (const [hour, map] of hourlyByUrl) {
    byHourUrl[hour] = Object.fromEntries(map);
  }
  for (const [hour, map] of hourlyByScreen) {
    byHourScreen[hour] = Object.fromEntries(map);
  }
  return { byHourUrl, byHourScreen };
}

export function logTopNetworkConsumers(limit = 10): void {
  if (!__DEV__) return;
  const hour = currentHourBucket();
  const urlMap = hourlyByUrl.get(hour) ?? new Map();
  const screenMap = hourlyByScreen.get(hour) ?? new Map();

  const topUrls = [...urlMap.entries()]
    .sort((a, b) => b[1].requestBytes + b[1].responseBytes - (a[1].requestBytes + a[1].responseBytes))
    .slice(0, limit)
    .map(([url, agg]) => ({
      url,
      count: agg.count,
      totalBytes: agg.requestBytes + agg.responseBytes,
      total: formatBytes(agg.requestBytes + agg.responseBytes),
    }));

  const topScreens = [...screenMap.entries()]
    .sort((a, b) => b[1].requestBytes + b[1].responseBytes - (a[1].requestBytes + a[1].responseBytes))
    .slice(0, limit)
    .map(([screen, agg]) => ({
      screen,
      count: agg.count,
      total: formatBytes(agg.requestBytes + agg.responseBytes),
    }));

  DebugLogger.logReport('TOP_NETWORK_CONSUMERS', { hour, topUrls, topScreens });
}
