/** expo-location reverseGeocodeAsync item shape (avoid tight coupling to package export). */
export type GeocodeLike = {
  name?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

/** Title + optional subtitle for WhatsApp-style location bubbles. */
export function formatGeocodeForLocationMessage(g: GeocodeLike): {
  placeName?: string;
  placeAddress?: string;
} {
  const streetLine = [g.streetNumber, g.street].filter(Boolean).join(' ').trim();
  const locality = (g.city || g.district || g.name || g.subregion || '').trim();
  const placeName = (locality || streetLine || g.region || g.country || '').trim() || undefined;

  const parts: string[] = [];
  if (streetLine && streetLine !== placeName) parts.push(streetLine);
  const cityLine = [g.city, g.region].filter(Boolean).join(', ').trim();
  if (cityLine && cityLine !== placeName && !parts.join(' ').includes(cityLine)) {
    parts.push(cityLine);
  } else if (g.region && g.region !== placeName && !parts.includes(g.region)) {
    parts.push(g.region);
  }
  if (g.postalCode && !parts.join(' ').includes(g.postalCode)) {
    parts.push(g.postalCode);
  }
  if (g.country && !parts.join(' ').includes(g.country)) {
    parts.push(g.country);
  }

  let placeAddress = parts.filter(Boolean).join(' · ').trim() || undefined;
  if (placeAddress === placeName) placeAddress = undefined;

  return { placeName, placeAddress };
}
