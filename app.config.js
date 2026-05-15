/**
 * Dynamic config: Expo merges `app.json` into `config` and passes it here.
 * @see https://docs.expo.dev/workflow/configuration/
 */
module.exports = ({ config }) => {
  const mapsKeyFromConfig =
    config.android?.config?.googleMaps?.apiKey?.trim() ||
    config.ios?.config?.googleMapsApiKey?.trim() ||
    '';
  const googleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    mapsKeyFromConfig ||
    '';

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android?.config || {}),
        ...(googleMapsApiKey
          ? {
              googleMaps: {
                apiKey: googleMapsApiKey,
              },
            }
          : {}),
      },
    },
    ios: {
      ...config.ios,
      config: {
        ...(config.ios?.config || {}),
        ...(googleMapsApiKey
          ? {
              googleMapsApiKey,
            }
          : {}),
      },
    },
    extra: {
      ...(config.extra || {}),
      EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    },
  };
};
