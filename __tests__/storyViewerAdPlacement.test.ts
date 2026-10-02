import {
  VIEWER_MIN_STORIES_FOR_ADS,
  buildStoryViewerFeed,
  computeViewerAdInsertions,
} from '@/lib/stories/storyViewerFeed';

describe('storyViewerFeed', () => {
  const makeStories = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `story-${index}`,
      userId: 'user-1',
      mediaUrl: 'https://example.com/image.jpg',
      mediaType: 'image' as const,
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      viewers: [],
      likes: [],
    }));

  it('returns no insertions when fewer than three stories', () => {
    expect(computeViewerAdInsertions(2)).toEqual([]);
  });

  it('inserts ads every 3-5 story slides', () => {
    const insertions = computeViewerAdInsertions(12);
    expect(insertions.length).toBeGreaterThan(0);
    expect(insertions[0]).toBeGreaterThanOrEqual(2);
  });

  it('omits ad slides when no ad is loaded', () => {
    const stories = makeStories(6);
    const feed = buildStoryViewerFeed(stories, new Map(), computeViewerAdInsertions(6));
    expect(feed.every((item) => item.type === 'story')).toBe(true);
    expect(feed).toHaveLength(6);
  });

  it('includes ad slides only for loaded slots', () => {
    const stories = makeStories(6);
    const firstSlot = computeViewerAdInsertions(6)[0];
    const feed = buildStoryViewerFeed(
      stories,
      new Map([[firstSlot, { responseId: 'mock' } as never]]),
      computeViewerAdInsertions(6),
    );
    expect(feed.some((item) => item.type === 'ad')).toBe(true);
    expect(feed.length).toBe(7);
  });

  it('requires minimum stories before ads', () => {
    expect(VIEWER_MIN_STORIES_FOR_ADS).toBe(3);
  });
});
