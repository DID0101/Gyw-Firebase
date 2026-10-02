import type { NativeAd } from 'react-native-google-mobile-ads';

import type { Story } from '@/lib/services/storyService';

/** Minimum real story slides before any viewer ad may appear. */
export const VIEWER_MIN_STORIES_FOR_ADS = 3;
const INTERVAL_MIN = 3;
const INTERVAL_SPREAD = 3; // yields 3, 4, or 5 story slides between ads

export type StoryViewerItem =
  | { type: 'story'; key: string; story: Story }
  | { type: 'ad'; key: string; slotIndex: number; nativeAd: NativeAd };

/**
 * Indices (0-based) of story slides after which a sponsored slide may appear.
 * Deterministic per story count; optional `reducedAds` pushes intervals further apart.
 */
export function computeViewerAdInsertions(
  storyCount: number,
  reducedAds = false,
): number[] {
  if (storyCount < VIEWER_MIN_STORIES_FOR_ADS) return [];

  const insertAfter: number[] = [];
  let storyIndex = 0;
  let storiesSinceAd = 0;
  let interval = INTERVAL_MIN + (storyCount % INTERVAL_SPREAD);
  if (reducedAds) interval += 2;

  while (storyIndex < storyCount) {
    storiesSinceAd += 1;
    if (storiesSinceAd >= interval) {
      insertAfter.push(storyIndex);
      storiesSinceAd = 0;
      interval =
        INTERVAL_MIN + ((insertAfter.length + storyCount) % INTERVAL_SPREAD);
      if (reducedAds) interval += 2;
    }
    storyIndex += 1;
  }

  return insertAfter;
}

export function buildStoryViewerFeed(
  stories: Story[],
  adsBySlot: ReadonlyMap<number, NativeAd>,
  insertions: readonly number[],
): StoryViewerItem[] {
  if (stories.length < VIEWER_MIN_STORIES_FOR_ADS) {
    return stories.map((story) => ({
      type: 'story' as const,
      key: `story-${story.id}`,
      story,
    }));
  }

  const insertionSet = new Set(insertions);
  const items: StoryViewerItem[] = [];

  stories.forEach((story, index) => {
    items.push({ type: 'story', key: `story-${story.id}`, story });
    if (insertionSet.has(index)) {
      const nativeAd = adsBySlot.get(index);
      if (nativeAd) {
        items.push({
          type: 'ad',
          key: `ad-after-${index}`,
          slotIndex: index,
          nativeAd,
        });
      }
    }
  });

  return items;
}

export function findViewerItemIndexByStoryId(
  items: StoryViewerItem[],
  storyId: string,
): number {
  return items.findIndex(
    (item) => item.type === 'story' && item.story.id === storyId,
  );
}
