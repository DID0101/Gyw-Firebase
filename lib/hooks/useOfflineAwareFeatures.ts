/**
 * Hook that gates features requiring a live connection.
 *
 * Returns per-feature availability and a helper `guardFeature(featureKey)`
 * that shows a toast when the feature is unavailable offline.
 */
import { useCallback, useMemo } from 'react';
import { useNetworkState } from '@/lib/networkState';
import { showToast } from '@/components/Toast';

export type GatedFeature =
  | 'voiceCall'
  | 'videoCall'
  | 'sendMedia'
  | 'sendLocation'
  | 'sendDocument'
  | 'groupManage';

const ALWAYS_ONLINE: Set<GatedFeature> = new Set([
  'voiceCall',
  'videoCall',
  'sendLocation',
  'groupManage',
]);

/**
 * Media / documents can be *queued* offline via the upload queue, but heavy
 * media (video) should warn the user.  We gate them softly — the queue
 * will pick them up on reconnect.
 */
const SOFT_GATE: Set<GatedFeature> = new Set([
  'sendMedia',
  'sendDocument',
]);

export function useOfflineAwareFeatures() {
  const { isOnline } = useNetworkState();

  const availability = useMemo(() => {
    const map: Record<GatedFeature, boolean> = {
      voiceCall: isOnline,
      videoCall: isOnline,
      sendMedia: true, // queued offline
      sendLocation: isOnline,
      sendDocument: true, // queued offline
      groupManage: isOnline,
    };
    return map;
  }, [isOnline]);

  /**
   * Call before triggering a gated feature. Returns `true` if the feature
   * is available; shows a toast and returns `false` otherwise.
   */
  const guardFeature = useCallback(
    (feature: GatedFeature): boolean => {
      if (ALWAYS_ONLINE.has(feature) && !isOnline) {
        showToast('This feature requires an internet connection.', 'warning');
        return false;
      }
      if (SOFT_GATE.has(feature) && !isOnline) {
        showToast("File will be sent when you're back online.", 'info');
      }
      return true;
    },
    [isOnline]
  );

  return { isOnline, availability, guardFeature };
}
