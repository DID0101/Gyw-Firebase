import type { Story } from '@/lib/services/storyService';

export const MIN_STORIES_FOR_ADS = 2;
/** Show a sponsored ring after every N story rings (max gap). */
export const STORY_AD_INTERVAL = 2;

export interface StoryGroup {
  userId: string;
  userName?: string;
  userImage?: string;
  stories: Story[];
  hasUnseen: boolean;
}

export type StoryFeedItem =
  | { type: 'story'; key: string; group: StoryGroup }
  | { type: 'ad'; key: string; slotIndex: number };

/**
 * Indices (0-based) of story rings after which a sponsored slot may appear.
 * Deterministic for a given story count — avoids layout churn on re-render.
 */
export function computeStoryAdInsertions(storyCount: number): number[] {
  if (storyCount < MIN_STORIES_FOR_ADS) return [];

  const insertAfter: number[] = [];
  let storyIndex = 0;
  let storiesSinceAd = 0;

  while (storyIndex < storyCount) {
    storiesSinceAd += 1;
    if (storiesSinceAd >= STORY_AD_INTERVAL) {
      insertAfter.push(storyIndex);
      storiesSinceAd = 0;
    }
    storyIndex += 1;
  }

  return insertAfter;
}

export function buildStoryFeedItems(
  groups: StoryGroup[],
  adsBySlot: ReadonlyMap<number, unknown>,
): StoryFeedItem[] {
  if (groups.length < MIN_STORIES_FOR_ADS) {
    return groups.map((group) => ({
      type: 'story' as const,
      key: `story-${group.userId}`,
      group,
    }));
  }

  const insertionSet = new Set(computeStoryAdInsertions(groups.length));
  const items: StoryFeedItem[] = [];

  groups.forEach((group, index) => {
    items.push({ type: 'story', key: `story-${group.userId}`, group });
    if (insertionSet.has(index) && adsBySlot.has(index)) {
      items.push({
        type: 'ad',
        key: `ad-after-${index}`,
        slotIndex: index,
      });
    }
  });

  return items;
}
