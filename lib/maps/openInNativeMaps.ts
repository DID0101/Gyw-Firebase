import { Linking, Platform } from 'react-native';

export type OpenInNativeMapsParams = {
  latitude: number;
  longitude: number;
  /** Shown in maps app search / pin label. */
  label?: string;
};

/**
 * Opens the system maps experience (Google Maps / Apple Maps / geo resolver).
 * Avoids in-app browser and web Google Maps unless nothing else succeeds.
 */
export async function openInNativeMaps(params: OpenInNativeMapsParams): Promise<void> {
  const lat = params.latitude;
  const lng = params.longitude;
  const label = (params.label ?? '').trim();
  const q = encodeURIComponent(label || 'Location');

  const tryOpen = async (url: string): Promise<boolean> => {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  };

  if (Platform.OS === 'web') {
    await tryOpen(
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
    );
    return;
  }

  if (Platform.OS === 'ios') {
    const iosUrls = [
      `maps://maps.apple.com/?ll=${lat},${lng}&q=${q}`,
      `http://maps.apple.com/?ll=${lat},${lng}&q=${q}`,
      `comgooglemaps://?q=${lat},${lng}&center=${lat},${lng}&zoom=16`,
    ];
    for (const url of iosUrls) {
      if (await tryOpen(url)) return;
    }
  } else {
    const androidUrls = [
      `geo:0,0?q=${lat},${lng}`,
      `geo:0,0?q=${lat},${lng}(${encodeURIComponent(label)})`,
      `comgooglemaps://?q=${lat},${lng}&center=${lat},${lng}&zoom=16`,
    ];
    for (const url of androidUrls) {
      if (await tryOpen(url)) return;
    }
  }

  await tryOpen(
    `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
  );
}
