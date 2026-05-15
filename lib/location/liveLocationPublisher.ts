import * as Location from 'expo-location';
import { AppState, type AppStateStatus } from 'react-native';
import { deleteLiveLocationSession, publishLiveLocationCoords } from '@/lib/services/chatService';
import { shouldPublishLiveUpdate } from '@/lib/location/geoThrottle';

export type LiveLocationPublisherOptions = {
  chatId: string;
  messageId: string;
  expiresAt: string;
  onError?: (e: unknown) => void;
};

/**
 * Foreground-only live location publishing: throttled Firestore writes, pauses when app backgrounded.
 * Stops GPS watch on cleanup; schedules best-effort session doc delete at expiry.
 */
export async function startLiveLocationPublisher(
  opts: LiveLocationPublisherOptions
): Promise<() => void> {
  const { chatId, messageId, expiresAt, onError } = opts;
  const expMs = new Date(expiresAt).getTime();
  let last: { at: number; lat: number; lng: number } | null = null;
  let appActive = AppState.currentState === 'active';
  const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
    appActive = s === 'active';
  });

  let watchSub: Location.LocationSubscription | null = null;

  const stopWatch = async () => {
    try {
      await watchSub?.remove();
    } catch {
      /* ignore */
    }
    watchSub = null;
  };

  const msToExpiry = Math.max(0, expMs - Date.now());
  const expiryTimer = setTimeout(() => {
    deleteLiveLocationSession(chatId, messageId).catch(() => {});
  }, msToExpiry);

  try {
    watchSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 22_000,
        distanceInterval: 30,
      },
      (loc) => {
        if (!appActive) return;
        if (Date.now() > expMs) return;
        const now = Date.now();
        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;
        if (!shouldPublishLiveUpdate(last, now, lat, lng)) return;
        last = { at: now, lat, lng };
        publishLiveLocationCoords(chatId, messageId, lat, lng).catch((e) => onError?.(e));
      }
    );
  } catch (e) {
    clearTimeout(expiryTimer);
    appSub.remove();
    onError?.(e);
    throw e;
  }

  return () => {
    clearTimeout(expiryTimer);
    appSub.remove();
    void stopWatch();
  };
}
