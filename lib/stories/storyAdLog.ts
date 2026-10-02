/**
 * Release-safe diagnostics for Stories native ads.
 * Filter Metro / logcat: STORY_AD
 */

import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';

export type StoryAdLogTag =
  | 'STORY_AD_REQUEST'
  | 'STORY_AD_LOADED'
  | 'STORY_AD_FAILED'
  | 'STORY_AD_RENDERED'
  | 'STORY_AD_CLICKED'
  | 'STORY_AD_IMPRESSION';

export function storyAdLog(
  tag: StoryAdLogTag,
  extra?: Record<string, unknown>,
): void {
  prodDebug('STORY_AD', { tag, ...extra });
}

export function storyAdLogError(
  tag: StoryAdLogTag,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  prodDebugError('STORY_AD', error, { tag, ...extra });
}
