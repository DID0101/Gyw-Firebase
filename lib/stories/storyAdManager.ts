import type { NativeAd } from 'react-native-google-mobile-ads';

import { ensureStoryAdConsent } from '@/lib/stories/storyAdConsent';
import { getStoryNativeAdUnitId, isStoryAdsSupported } from '@/lib/stories/storyAdConfig';
import { storyAdLog, storyAdLogError } from '@/lib/stories/storyAdLog';

type PoolListener = () => void;

const MAX_POOL_SIZE = 3;

class StoryAdManager {
  private pool: NativeAd[] = [];
  private inflight = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sessionId = 0;
  private listeners = new Set<PoolListener>();

  subscribe(listener: PoolListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private async ensureInitialized(): Promise<void> {
    if (!isStoryAdsSupported()) return;
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const { default: mobileAds } = await import('react-native-google-mobile-ads');
      await mobileAds().initialize();
      this.initialized = true;
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  prefetchFirst(): void {
    if (!isStoryAdsSupported()) return;
    void this.ensureInitialized().then(() => this.loadNext());
  }

  private loadNext(): void {
    if (!isStoryAdsSupported()) return;
    if (this.pool.length + this.inflight >= MAX_POOL_SIZE) return;

    const session = this.sessionId;
    this.inflight += 1;
    storyAdLog('STORY_AD_REQUEST', { adUnitId: getStoryNativeAdUnitId() });

    void ensureStoryAdConsent()
      .then((allowed) => {
        if (!allowed) {
          throw new Error('story_ad_consent_denied');
        }
        return import('react-native-google-mobile-ads');
      })
      .then(({ NativeAd }) =>
        NativeAd.createForAdRequest(getStoryNativeAdUnitId()),
      )
      .then((ad) => {
        if (session !== this.sessionId) {
          ad.destroy();
          return;
        }
        this.pool.push(ad);
        storyAdLog('STORY_AD_LOADED', { responseId: ad.responseId });
        this.notify();
        this.loadNext();
      })
      .catch((error) => {
        storyAdLog('STORY_AD_FAILED', {
          message: error instanceof Error ? error.message : String(error),
        });
        storyAdLogError('STORY_AD_FAILED', error);
      })
      .finally(() => {
        this.inflight = Math.max(0, this.inflight - 1);
      });
  }

  consumeAd(): NativeAd | null {
    const ad = this.pool.shift() ?? null;
    if (ad) {
      this.loadNext();
    }
    return ad;
  }

  getReadyCount(): number {
    return this.pool.length;
  }

  destroyAll(): void {
    this.sessionId += 1;
    this.pool.forEach((ad) => ad.destroy());
    this.pool = [];
    this.inflight = 0;
    this.notify();
  }
}

export const storyAdManager = new StoryAdManager();

export function prefetchStoryAdsOnTabPress(): void {
  storyAdManager.prefetchFirst();
}

export function releaseStoryAdsOnTabBlur(): void {
  storyAdManager.destroyAll();
}
