import { runAfterInteractions, runOnIdle } from '@/lib/perf/defer';

let storyServicePrefetchDone = false;
let profileModalPrefetchDone = false;
let callServicePrefetchDone = false;

/**
 * After the main shell is visible, prefetch small JS chunks for likely-next routes.
 * Does not mount screens or load full chat histories.
 */
export function scheduleLikelyRouteChunksIdle(): void {
  runAfterInteractions(() => {
    runOnIdle(() => {
      if (!storyServicePrefetchDone) {
        storyServicePrefetchDone = true;
        void import('@/lib/services/storyService').catch(() => {});
      }
    }, 600);

    runOnIdle(() => {
      if (!profileModalPrefetchDone) {
        profileModalPrefetchDone = true;
        void import('@/app/(home)/(modal)/profile').catch(() => {});
      }
    }, 1400);

    runOnIdle(() => {
      if (!callServicePrefetchDone) {
        callServicePrefetchDone = true;
        void import('@/lib/services/callService').catch(() => {});
      }
    }, 900);
  });
}
