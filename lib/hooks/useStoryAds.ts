import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { NativeAd } from 'react-native-google-mobile-ads';

import { computeStoryAdInsertions } from '@/lib/stories/storyAdPlacement';
import { isStoryAdsSupported } from '@/lib/stories/storyAdConfig';
import { storyAdManager } from '@/lib/stories/storyAdManager';

/**
 * Assigns preloaded native ads to deterministic story-ring insertion slots.
 * Story rendering never waits on ads — slots stay empty until an ad is ready.
 */
export function useStoryAds(storyGroupCount: number): Map<number, NativeAd> {
  const [adsBySlot, setAdsBySlot] = useState<Map<number, NativeAd>>(() => new Map());
  const assignedSlotsRef = useRef<Set<number>>(new Set());

  const tryAssignAds = useCallback(() => {
    if (!isStoryAdsSupported()) return;

    const insertions = computeStoryAdInsertions(storyGroupCount);
    if (insertions.length === 0) return;

    setAdsBySlot((prev) => {
      let changed = false;
      const next = new Map(prev);

      for (const slotIndex of insertions) {
        if (assignedSlotsRef.current.has(slotIndex) || next.has(slotIndex)) {
          continue;
        }
        const ad = storyAdManager.consumeAd();
        if (!ad) break;
        assignedSlotsRef.current.add(slotIndex);
        next.set(slotIndex, ad);
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [storyGroupCount]);

  useFocusEffect(
    useCallback(() => {
      if (!isStoryAdsSupported()) {
        return undefined;
      }

      storyAdManager.prefetchFirst();
      tryAssignAds();

      return () => {
        setAdsBySlot((prev) => {
          prev.forEach((ad) => ad.destroy());
          return new Map();
        });
        assignedSlotsRef.current.clear();
        storyAdManager.destroyAll();
      };
    }, [tryAssignAds]),
  );

  useEffect(() => {
    if (!isStoryAdsSupported()) return undefined;

    tryAssignAds();
    return storyAdManager.subscribe(tryAssignAds);
  }, [tryAssignAds]);

  useEffect(() => {
    const validSlots = new Set(computeStoryAdInsertions(storyGroupCount));
    setAdsBySlot((prev) => {
      let changed = false;
      const next = new Map<number, NativeAd>();

      prev.forEach((ad, slotIndex) => {
        if (validSlots.has(slotIndex)) {
          next.set(slotIndex, ad);
        } else {
          ad.destroy();
          assignedSlotsRef.current.delete(slotIndex);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [storyGroupCount]);

  return adsBySlot;
}
