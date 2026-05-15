/** Haversine distance in meters. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371000;
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export const LIVE_MIN_INTERVAL_MS = 25_000;
export const LIVE_MIN_DISTANCE_M = 40;

export function shouldPublishLiveUpdate(
  last: { at: number; lat: number; lng: number } | null,
  now: number,
  lat: number,
  lng: number
): boolean {
  if (!last) return true;
  if (now - last.at >= LIVE_MIN_INTERVAL_MS) return true;
  return distanceMeters({ latitude: last.lat, longitude: last.lng }, { latitude: lat, longitude: lng }) >= LIVE_MIN_DISTANCE_M;
}
