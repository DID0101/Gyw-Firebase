export type StaticMapPreviewOptions = {
  /** When false, map has no server-side pin — use a centered pin overlay in UI (WhatsApp-style). Default true for backward compatibility. */
  showMarker?: boolean;
};

/** OSM static map (no API key). Used for chat bubble previews only — not for interactive maps. */
export function buildStaticMapPreviewUrl(
  latitude: number,
  longitude: number,
  width = 400,
  height = 240,
  options?: StaticMapPreviewOptions
): string {
  const lat = clampLat(latitude);
  const lng = clampLng(longitude);
  const w = Math.round(Math.min(640, Math.max(200, width)));
  const h = Math.round(Math.min(640, Math.max(120, height)));
  const showMarker = options?.showMarker !== false;
  const markers = showMarker ? `&markers=${lat},${lng},lightblue1` : '';
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=${w}x${h}${markers}`;
}

function clampLat(x: number): number {
  return Math.max(-85, Math.min(85, x));
}

function clampLng(x: number): number {
  return Math.max(-180, Math.min(180, x));
}
