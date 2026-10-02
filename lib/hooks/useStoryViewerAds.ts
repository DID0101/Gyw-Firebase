import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { NativeAd } from 'react-native-google-mobile-ads';

import { isStoryAdsSupported } from '@/lib/stories/storyAdConfig';
import { getStoryAdsReduced } from '@/lib/stories/storyAdPreferences';
import { storyAdManager } from '@/lib/stories/storyAdManager';
import {
  buildStoryViewerFeed,
  computeViewerAdInsertions,
  type StoryViewerItem,
} from '@/lib/stories/storyViewerFeed';
import type { Story } from '@/lib/services/storyService';

export function useStoryViewerAds(stories: Story[]): {
  viewerItems: StoryViewerItem[];
  adsReduced: boolean;
} {
  const [adsBySlot, setAdsBySlot] = useState<Map<number, NativeAd>>(
    () => new Map(),
  );
  const [adsReduced, setAdsReduced] = useState(false);
  const assignedSlotsRef = useRef<Set<number>>(new Set());
  const assignedAdsRef = useRef<Map<number, NativeAd>>(new Map());

  const insertionSlots = useMemo(
    () => computeViewerAdInsertions(stories.length, adsReduced),
    [stories.length, adsReduced],
  );

  const tryAssignAds = useCallback(() => {
    if (!isStoryAdsSupported() || insertionSlots.length === 0) return;

    setAdsBySlot((prev) => {
      let changed = false;
      const next = new Map(prev);

      for (const slotIndex of insertionSlots) {
        if (assignedSlotsRef.current.has(slotIndex) || next.has(slotIndex)) {
          continue;
        }
        const ad = storyAdManager.consumeAd();
        if (!ad) break;
        assignedSlotsRef.current.add(slotIndex);
        assignedAdsRef.current.set(slotIndex, ad);
        next.set(slotIndex, ad);
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [insertionSlots]);

  useEffect(() => {
    if (!isStoryAdsSupported()) return undefined;

    void getStoryAdsReduced().then(setAdsReduced);
    storyAdManager.prefetchFirst();
    tryAssignAds();

    const unsubPool = storyAdManager.subscribe(tryAssignAds);
    const onAppState = (state: AppStateStatus) => {
      if (state !== 'active') {
        storyAdManager.destroyAll();
      } else {
        storyAdManager.prefetchFirst();
        tryAssignAds();
      }
    };
    const appSub = AppState.addEventListener('change', onAppState);

    return () => {
      unsubPool();
      appSub.remove();
      assignedAdsRef.current.forEach((ad) => ad.destroy());
      assignedAdsRef.current.clear();
      assignedSlotsRef.current.clear();
      setAdsBySlot(new Map());
      storyAdManager.destroyAll();
    };
  }, [tryAssignAds]);

  useEffect(() => {
    const validSlots = new Set(insertionSlots);
    setAdsBySlot((prev) => {
      let changed = false;
      const next = new Map<number, NativeAd>();

      prev.forEach((ad, slotIndex) => {
        if (validSlots.has(slotIndex)) {
          next.set(slotIndex, ad);
        } else {
          ad.destroy();
          assignedSlotsRef.current.delete(slotIndex);
          assignedAdsRef.current.delete(slotIndex);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [insertionSlots]);

  const viewerItems = useMemo(
    () => buildStoryViewerFeed(stories, adsBySlot, insertionSlots),
    [stories, adsBySlot, insertionSlots],
  );

  return { viewerItems, adsReduced };
}
