/**
 * Deterministic Stories native-ad slot placement.
 */

import {
  MIN_STORIES_FOR_ADS,
  STORY_AD_INTERVAL,
  buildStoryFeedItems,
  computeStoryAdInsertions,
  type StoryGroup,
} from '@/lib/stories/storyAdPlacement';

describe('storyAdPlacement', () => {
  const makeGroups = (count: number): StoryGroup[] =>
    Array.from({ length: count }, (_, index) => ({
      userId: `user-${index}`,
      stories: [],
      hasUnseen: false,
    }));

  it('returns no insertions when fewer than two story rings', () => {
    expect(computeStoryAdInsertions(1)).toEqual([]);
    expect(buildStoryFeedItems(makeGroups(1), new Map()).every((item) => item.type === 'story')).toBe(
      true,
    );
  });

  it('inserts ads every two story rings without consecutive-only ads', () => {
    const insertions = computeStoryAdInsertions(8);
    expect(insertions).toEqual([1, 3, 5, 7]);

    let lastStoryIndex = -1;
    for (const index of insertions) {
      const gap = index - lastStoryIndex;
      expect(gap).toBe(STORY_AD_INTERVAL);
      lastStoryIndex = index;
    }
  });

  it('omits ad slots when no ad is loaded', () => {
    const groups = makeGroups(4);
    const feed = buildStoryFeedItems(groups, new Map());
    expect(feed.every((item) => item.type === 'story')).toBe(true);
    expect(feed).toHaveLength(4);
  });

  it('includes ad items only for loaded slots', () => {
    const groups = makeGroups(4);
    const firstSlot = computeStoryAdInsertions(4)[0];
    expect(firstSlot).toBe(1);
    const ads = new Map<number, unknown>([[firstSlot, { mock: true }]]);
    const feed = buildStoryFeedItems(groups, ads);
    const adItems = feed.filter((item) => item.type === 'ad');
    expect(adItems).toHaveLength(1);
    expect(adItems[0]).toMatchObject({ type: 'ad', slotIndex: firstSlot });
  });

  it('requires at least MIN_STORIES_FOR_ADS rings before any slot', () => {
    expect(MIN_STORIES_FOR_ADS).toBe(2);
    expect(computeStoryAdInsertions(MIN_STORIES_FOR_ADS - 1)).toEqual([]);
    expect(computeStoryAdInsertions(MIN_STORIES_FOR_ADS)).toEqual([1]);
  });
});
