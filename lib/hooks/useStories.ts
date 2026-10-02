import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { collection, query, where, onSnapshot, Timestamp, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Story } from '@/lib/services/storyService';
import { useStoryStore } from '@/store/storyStore';
import { FIRESTORE_SNAPSHOT_OPTS, hasNativeFirestore, subscribeToStoriesNative } from '@/lib/firestoreNative';
import { storiesLoadLog } from '@/lib/debug/storiesLoadingTrace';
import {
  prefetchStoryAdsOnTabPress,
  releaseStoryAdsOnTabBlur,
} from '@/lib/stories/storyAdManager';
import {
  endHangWatch,
  getRuntimeQueryState,
  logFirestoreQuery,
  logSilentEmptyState,
  logScreenLifecycle,
  onRuntimeReadyStateChange,
  startHangWatch,
  updateHangWatch,
} from '@/lib/debug/runtimeDiagnostics';

type StoriesListener = () => void;

const LOADING_TIMEOUT_MS = 10_000;

let globalUnsubscribe: (() => void) | null = null;
let subscriberCount = 0;
let prefetchHold = false;
let queryStarted = false;
let lastStoriesFingerprint: string | null = null;
let querySettled = false;
const settleListeners = new Set<() => void>();

function storiesListFingerprint(stories: Story[]): string {
  if (stories.length === 0) return '__empty__';
  return stories.map((s) => `${s.id}:${s.createdAt}`).join('|');
}

function notifyQuerySettled(docCount: number, reason: string): void {
  if (querySettled) return;
  querySettled = true;
  updateHangWatch('stories.loading', {
    lastSuccessfulEvent: `query_settled:${reason}:${docCount}`,
  });
  storiesLoadLog('STORIES_QUERY_SUCCESS', { reason, docCount });
  storiesLoadLog('STORIES_DOCS_COUNT', { count: docCount });
  storiesLoadLog('STORIES_PROCESSING_COMPLETE', { docCount });
  settleListeners.forEach((fn) => fn());
}

function resetQueryState(): void {
  querySettled = false;
  queryStarted = false;
  lastStoriesFingerprint = null;
}

function mapSnapshotToStories(
  snapshot: { forEach: (fn: (doc: { id: string; data: () => Record<string, unknown> }) => void) => void },
): Story[] {
  const storiesData: Story[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    storiesData.push({
      id: doc.id,
      userId: data.userId as string,
      mediaUrl: data.mediaUrl as string,
      mediaType: data.mediaType as 'image' | 'video',
      thumbnailUrl: data.thumbnailUrl as string | undefined,
      caption: data.caption as string | undefined,
      createdAt:
        (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ||
        (data.createdAt as string) ||
        new Date().toISOString(),
      expiresAt:
        (data.expiresAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ||
        (data.expiresAt as string) ||
        new Date().toISOString(),
      viewers: (data.viewers as Story['viewers']) || [],
      likes: (data.likes as string[]) || [],
    });
  });
  storiesData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return storiesData;
}

function applyStories(storiesData: Story[], fromCache: boolean) {
  storiesLoadLog('STORIES_PROCESSING_START', { count: storiesData.length, fromCache });
  const fp = storiesListFingerprint(storiesData);
  if (lastStoriesFingerprint !== null && fp === lastStoriesFingerprint) {
    notifyQuerySettled(storiesData.length, 'duplicate_snapshot');
    return;
  }
  lastStoriesFingerprint = fp;
  useStoryStore.getState().setStories(storiesData);
  notifyQuerySettled(storiesData.length, fromCache ? 'cache_snapshot' : 'server_snapshot');
}

function startGlobalStoriesListener(): () => void {
  if (globalUnsubscribe) return globalUnsubscribe;

  const runtime = getRuntimeQueryState();
  if (!runtime.firebaseReady || !runtime.authReady || !runtime.authUid) {
    logFirestoreQuery({
      collection: 'stories',
      where: [{ field: 'expiresAt', op: '>', value: 'now' }],
      event: 'BLOCKED_BEFORE_READY',
      screen: 'Stories',
      op: 'listen_active_stories',
      provider: Platform.OS !== 'web' && hasNativeFirestore ? 'native' : 'web',
      extra: {
        firebaseReady: runtime.firebaseReady,
        firebaseProvider: runtime.firebaseProvider,
        authReady: runtime.authReady,
        authUid: runtime.authUid,
      },
    });
    return () => {};
  }

  if (!queryStarted) {
    queryStarted = true;
    storiesLoadLog('STORIES_QUERY_START');
    logScreenLifecycle('Stories', 'QUERY_START', {
      provider: Platform.OS !== 'web' && hasNativeFirestore ? 'native' : 'web',
      authUid: runtime.authUid,
    });
  }

  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const startedAtMs = Date.now();
    logFirestoreQuery({
      collection: 'stories',
      where: [{ field: 'expiresAt', op: '>', value: 'now' }],
      event: 'LISTENER_START',
      screen: 'Stories',
      op: 'listen_active_stories',
      provider: 'native',
      startedAtMs,
    });
    globalUnsubscribe = subscribeToStoriesNative(
      (storiesData) => {
        logFirestoreQuery({
          collection: 'stories',
          where: [{ field: 'expiresAt', op: '>', value: 'now' }],
          event: 'LISTENER_RESULT',
          screen: 'Stories',
          op: 'listen_active_stories',
          provider: 'native',
          startedAtMs,
          expectedResultCount: '>=0',
          actualResultCount: storiesData.length,
        });
        logScreenLifecycle('Stories', 'QUERY_RESULT', {
          count: storiesData.length,
          elapsedMs: Date.now() - startedAtMs,
        });
        if (storiesData.length === 0) {
          logSilentEmptyState('Stories', {
            collection: 'stories',
            where: [{ field: 'expiresAt', op: '>', value: 'now' }],
            lastSuccessfulEvent: 'native_empty_snapshot',
          });
        }
        applyStories(storiesData as Story[], false);
      },
      (err) => {
        logFirestoreQuery({
          collection: 'stories',
          where: [{ field: 'expiresAt', op: '>', value: 'now' }],
          event: 'LISTENER_ERROR',
          screen: 'Stories',
          op: 'listen_active_stories',
          provider: 'native',
          startedAtMs,
          permissionError: err,
        });
        updateHangWatch('stories.loading', {
          lastFailedEvent: err?.message ?? String(err),
        });
        storiesLoadLog('STORIES_QUERY_ERROR', { message: err?.message ?? String(err) });
        notifyQuerySettled(0, 'native_error');
      },
    );
    return globalUnsubscribe;
  }

  const now = Timestamp.now();
  const storiesRef = collection(db, 'stories');
  const q = query(storiesRef, where('expiresAt', '>', now), limit(80));
  const startedAtMs = Date.now();
  logFirestoreQuery({
    collection: 'stories',
    where: [{ field: 'expiresAt', op: '>', value: 'now' }],
    event: 'LISTENER_START',
    screen: 'Stories',
    op: 'listen_active_stories',
    provider: 'web',
    startedAtMs,
  });

  globalUnsubscribe = onSnapshot(
    q,
    FIRESTORE_SNAPSHOT_OPTS,
    (snapshot) => {
      const fromCache = snapshot.metadata.fromCache;
      const mapped = mapSnapshotToStories(snapshot);
      logFirestoreQuery({
        collection: 'stories',
        where: [{ field: 'expiresAt', op: '>', value: 'now' }],
        event: 'LISTENER_RESULT',
        screen: 'Stories',
        op: 'listen_active_stories',
        provider: 'web',
        startedAtMs,
        expectedResultCount: '>=0',
        actualResultCount: mapped.length,
        extra: { fromCache },
      });
      logScreenLifecycle('Stories', 'QUERY_RESULT', {
        count: mapped.length,
        elapsedMs: Date.now() - startedAtMs,
      });
      if (mapped.length === 0) {
        logSilentEmptyState('Stories', {
          collection: 'stories',
          where: [{ field: 'expiresAt', op: '>', value: 'now' }],
          lastSuccessfulEvent: fromCache ? 'web_empty_cache_snapshot' : 'web_empty_server_snapshot',
        });
      }
      applyStories(mapped, fromCache);
    },
    (error) => {
      logFirestoreQuery({
        collection: 'stories',
        where: [{ field: 'expiresAt', op: '>', value: 'now' }],
        event: 'LISTENER_ERROR',
        screen: 'Stories',
        op: 'listen_active_stories',
        provider: 'web',
        startedAtMs,
        permissionError: error,
      });
      updateHangWatch('stories.loading', {
        lastFailedEvent: error instanceof Error ? error.message : String(error),
      });
      storiesLoadLog('STORIES_QUERY_ERROR', {
        message: error instanceof Error ? error.message : String(error),
      });
      if (__DEV__) console.error('Error listening to stories:', error);
      notifyQuerySettled(0, 'web_error');
    },
  );

  return globalUnsubscribe;
}

function maybeStopGlobalStoriesListener(): void {
  if (subscriberCount > 0 || prefetchHold) return;
  if (globalUnsubscribe) {
    globalUnsubscribe();
    globalUnsubscribe = null;
  }
  resetQueryState();
}

function subscribeGlobalStories(onStoreChange: StoriesListener): () => void {
  subscriberCount += 1;
  prefetchHold = false;
  startGlobalStoriesListener();

  const unsubStore = useStoryStore.subscribe(onStoreChange);

  return () => {
    unsubStore();
    subscriberCount = Math.max(0, subscriberCount - 1);
    maybeStopGlobalStoriesListener();
  };
}

function subscribeQuerySettled(onSettled: () => void): () => void {
  settleListeners.add(onSettled);
  if (querySettled) onSettled();
  return () => settleListeners.delete(onSettled);
}

/** Start Firestore subscription on tab press (before lazy screen mount). */
export function prefetchStoriesOnTabPress(): void {
  prefetchHold = true;
  startGlobalStoriesListener();
  prefetchStoryAdsOnTabPress();
}

/** Release prefetch-only hold when leaving Stories tab without a mounted subscriber. */
export function releaseStoriesPrefetchHold(): void {
  prefetchHold = false;
  releaseStoryAdsOnTabBlur();
  maybeStopGlobalStoriesListener();
}

function getCachedStories(): Story[] {
  return useStoryStore.getState().allStories;
}

function hasCachedStories(): boolean {
  return getCachedStories().length > 0;
}

export const useStories = () => {
  const allStories = useSyncExternalStore(
    subscribeGlobalStories,
    () => useStoryStore.getState().allStories,
    () => useStoryStore.getState().allStories,
  );

  const [loading, setLoading] = useState(() => !hasCachedStories());

  const clearLoading = useCallback((reason: string) => {
    setLoading((prev) => {
      if (!prev) return prev;
      storiesLoadLog('STORIES_LOADING_FALSE', { reason });
      return false;
    });
  }, []);

  useEffect(() => {
    if (loading) {
      startHangWatch('stories.loading', 'Stories', {
        lastSuccessfulEvent: queryStarted ? 'query_started' : 'waiting_for_query',
        timeoutMs: 8_000,
      });
      storiesLoadLog('STORIES_LOADING_TRUE', {
        cachedCount: getCachedStories().length,
        querySettled,
      });
    } else {
      endHangWatch('stories.loading', 'loading_false');
    }
  }, [loading]);

  useEffect(() => {
    const runtime = getRuntimeQueryState();
    if (runtime.firebaseReady && runtime.authReady && runtime.authUid && !globalUnsubscribe) {
      startGlobalStoriesListener();
    }
  }, []);

  useEffect(() => {
    return onRuntimeReadyStateChange(() => {
      const runtime = getRuntimeQueryState();
      if (runtime.firebaseReady && runtime.authReady && runtime.authUid && !globalUnsubscribe) {
        startGlobalStoriesListener();
      }
    });
  }, []);

  useEffect(() => {
    if (hasCachedStories()) {
      clearLoading('cached_stories_on_mount');
    }

    const unsubSettled = subscribeQuerySettled(() => {
      clearLoading('firestore_query_settled');
    });

    const timeout = setTimeout(() => {
      if (!querySettled) {
        storiesLoadLog('STORIES_LOADING_TIMEOUT', { ms: LOADING_TIMEOUT_MS });
        updateHangWatch('stories.loading', { lastFailedEvent: 'stories_loading_timeout_10s' });
        notifyQuerySettled(0, 'timeout');
        clearLoading('timeout_10s');
      }
    }, LOADING_TIMEOUT_MS);

    return () => {
      unsubSettled();
      clearTimeout(timeout);
    };
  }, [clearLoading]);

  return { stories: allStories, loading };
};
