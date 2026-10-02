/**
 * Stories tab latency instrumentation.
 * Filter Metro / logcat: STORIES_PERF
 */

export type StoriesPerfTag =
  | 'STORIES_TAB_PRESS'
  | 'STORIES_SCREEN_MOUNT'
  | 'STORIES_FIRESTORE_QUERY_START'
  | 'STORIES_FIRESTORE_FIRST_RESULT'
  | 'STORIES_FIRESTORE_COMPLETE'
  | 'STORIES_RENDER_START'
  | 'STORIES_FIRST_STORY_RENDERED'
  | 'STORIES_THUMBNAIL_LOAD_START'
  | 'STORIES_THUMBNAIL_LOAD_COMPLETE'
  | 'STORIES_READY'
  | 'STORIES_RERENDER_COUNT'
  | 'STORIES_ACTIVE_LISTENERS'
  | 'STORIES_QUERY_COUNT'
  | 'STORIES_IMAGE_CACHE_HIT'
  | 'STORIES_IMAGE_CACHE_MISS';

type Session = {
  t0: number;
  marks: Map<StoriesPerfTag, number>;
  once: Set<StoriesPerfTag>;
};

let session: Session | null = null;
let activeListeners = 0;
let queryCount = 0;
let rerenderCount = 0;
let lastRerenderLogAt = 0;
const loadedImageUris = new Set<string>();

function log(
  tag: StoriesPerfTag,
  msSinceT0: number,
  deltaMs: number,
  extra?: Record<string, unknown>,
): void {
  const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(
    `STORIES_PERF tag=${tag} ms=${msSinceT0} delta=${deltaMs}${extraStr}`,
  );
}

export function storiesPerfResetSession(): void {
  session = { t0: Date.now(), marks: new Map(), once: new Set() };
  rerenderCount = 0;
}

export function storiesPerfMark(
  tag: StoriesPerfTag,
  extra?: Record<string, unknown>,
): void {
  if (!session) storiesPerfResetSession();
  const s = session!;
  const now = Date.now();
  const oneShot =
    tag === 'STORIES_TAB_PRESS' ||
    tag === 'STORIES_SCREEN_MOUNT' ||
    tag === 'STORIES_FIRESTORE_QUERY_START' ||
    tag === 'STORIES_FIRESTORE_FIRST_RESULT' ||
    tag === 'STORIES_FIRESTORE_COMPLETE' ||
    tag === 'STORIES_RENDER_START' ||
    tag === 'STORIES_FIRST_STORY_RENDERED' ||
    tag === 'STORIES_READY';
  if (oneShot && s.once.has(tag)) return;
  if (oneShot) s.once.add(tag);

  const prevMark = [...s.marks.entries()].sort((a, b) => a[1] - b[1]).at(-1)?.[1];
  s.marks.set(tag, now);
  const msSinceT0 = now - s.t0;
  const deltaMs = prevMark != null ? now - prevMark : 0;
  log(tag, msSinceT0, deltaMs, extra);
}

export function storiesPerfBumpRerender(extra?: Record<string, unknown>): void {
  rerenderCount += 1;
  const now = Date.now();
  if (rerenderCount > 1 && now - lastRerenderLogAt < 400) return;
  lastRerenderLogAt = now;
  if (!session) storiesPerfResetSession();
  const ms = now - session!.t0;
  log('STORIES_RERENDER_COUNT', ms, 0, { count: rerenderCount, ...extra });
}

export function storiesPerfSetActiveListeners(count: number): void {
  activeListeners = count;
  if (!session) storiesPerfResetSession();
  const ms = Date.now() - session!.t0;
  log('STORIES_ACTIVE_LISTENERS', ms, 0, { count: activeListeners });
}

export function storiesPerfBumpQueryCount(): number {
  queryCount += 1;
  if (!session) storiesPerfResetSession();
  const ms = Date.now() - session!.t0;
  log('STORIES_QUERY_COUNT', ms, 0, { count: queryCount });
  return queryCount;
}

export function storiesPerfGetQueryCount(): number {
  return queryCount;
}

export function storiesPerfGetActiveListeners(): number {
  return activeListeners;
}

export function storiesPerfImageLoad(uri: string | undefined): void {
  if (!uri) return;
  if (!session) storiesPerfResetSession();
  const hit = loadedImageUris.has(uri);
  storiesPerfMark(hit ? 'STORIES_IMAGE_CACHE_HIT' : 'STORIES_IMAGE_CACHE_MISS', {
    uri: uri.length > 80 ? `${uri.slice(0, 80)}…` : uri,
  });
  loadedImageUris.add(uri);
}

export function storiesPerfPrefetchTabPress(): void {
  storiesPerfResetSession();
  storiesPerfMark('STORIES_TAB_PRESS');
}
