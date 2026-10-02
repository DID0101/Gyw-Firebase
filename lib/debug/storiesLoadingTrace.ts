/**
 * Stories loading pipeline debug logs.
 * Filter Metro / logcat: STORIES_LOAD
 */

import { prodDebug } from '@/lib/debug/prodDebug';

export type StoriesLoadTag =
  | 'STORIES_SCREEN_MOUNT'
  | 'STORIES_LOADING_TRUE'
  | 'STORIES_LOADING_FALSE'
  | 'STORIES_LOADING_TIMEOUT'
  | 'STORIES_QUERY_START'
  | 'STORIES_QUERY_SUCCESS'
  | 'STORIES_QUERY_ERROR'
  | 'STORIES_DOCS_COUNT'
  | 'STORIES_PROCESSING_START'
  | 'STORIES_PROCESSING_COMPLETE'
  | 'STORIES_USERS_FETCH_START'
  | 'STORIES_USERS_FETCH_COMPLETE'
  | 'STORIES_IMAGES_LOAD_START'
  | 'STORIES_IMAGES_LOAD_COMPLETE';

export function storiesLoadLog(
  tag: StoriesLoadTag,
  extra?: Record<string, unknown>,
): void {
  prodDebug('STORIES_LOAD', { tag, ...extra });
}
