import { useEffect } from 'react';

import {
  batchCheckStoryViewsForViewer,
  legacyStorySeenByUser,
  type Story,
} from '@/lib/services/storyService';
import { useStoryStore } from '@/store/storyStore';

/**
 * Hydrates local seen ids from AsyncStorage, then occasionally syncs with
 * `stories/{storyId}/views/{viewerUid}` for stories not yet marked (subcollection source of truth).
 */
export function useStorySeenSync(viewerUid: string | undefined, stories: Story[]) {
  const markStoriesViewed = useStoryStore((s) => s.markStoriesViewed);
  const hydrateViewedStoryIds = useStoryStore((s) => s.hydrateViewedStoryIds);
  const viewedStoryIds = useStoryStore((s) => s.viewedStoryIds);

  useEffect(() => {
    if (!viewerUid) return;
    void hydrateViewedStoryIds(viewerUid);
  }, [viewerUid, hydrateViewedStoryIds]);

  const storyIdsKey = viewerUid
    ? stories
        .filter((s) => s.userId !== viewerUid)
        .map((s) => s.id)
        .sort()
        .join('|')
    : '';

  const viewedKey = viewerUid ? Object.keys(viewedStoryIds).sort().join(',') : '';

  useEffect(() => {
    if (!viewerUid || !storyIdsKey) return;

    const t = setTimeout(() => {
      const list = useStoryStore.getState().allStories;
      const viewed = useStoryStore.getState().viewedStoryIds;
      const candidates: string[] = [];
      for (const s of list) {
        if (!s?.id || s.userId === viewerUid) continue;
        if (viewed[s.id]) continue;
        if (legacyStorySeenByUser(s, viewerUid)) continue;
        candidates.push(s.id);
      }
      if (candidates.length === 0) return;
      void batchCheckStoryViewsForViewer(candidates, viewerUid).then((ids) => {
        if (ids.length > 0) markStoriesViewed(ids, viewerUid);
      });
    }, 1100);
    return () => clearTimeout(t);
  }, [viewerUid, storyIdsKey, viewedKey, markStoriesViewed]);
}
