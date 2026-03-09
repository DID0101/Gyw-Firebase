/**
 * Expo config plugin: add tools:replace="android:resource" to the
 * com.google.firebase.messaging.default_notification_color meta-data
 * so the app's value wins over react-native-firebase_messaging's in the manifest merger.
 *
 * Required when both expo-notifications and @react-native-firebase/messaging
 * contribute the same meta-data key with different resource references.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const META_DATA_NAME = 'com.google.firebase.messaging.default_notification_color';

function withAndroidManifestMergerFix(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    if (!androidManifest?.manifest) return config;

    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);

    const manifestRoot = androidManifest.manifest;
    const application = manifestRoot.application;
    const applications = Array.isArray(application) ? application : application ? [application] : [];
    for (const app of applications) {
      const metaDataList = app['meta-data'];
      const list = Array.isArray(metaDataList) ? metaDataList : metaDataList ? [metaDataList] : [];
      for (const item of list) {
        if (item?.$?.['android:name'] === META_DATA_NAME) {
          item.$['tools:replace'] = 'android:resource';
          break;
        }
      }
    }
    return config;
  });
}

module.exports = withAndroidManifestMergerFix;
