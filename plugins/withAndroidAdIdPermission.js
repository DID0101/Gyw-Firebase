/**
 * Ensure com.google.android.gms.permission.AD_ID survives manifest merge.
 * Play Console blocks releases when the advertising ID declaration is Yes
 * but this permission is missing (Android 13+ / targetSdk 33+).
 *
 * Some Google Play / Firebase measurement AARs remove AD_ID via tools:node="remove";
 * app-level tools:node="replace" wins the merger.
 */
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const AD_ID = 'com.google.android.gms.permission.AD_ID';

function withAndroidAdIdPermission(config) {
  return withAndroidManifest(config, (cfg) => {
    AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);

    const root = cfg.modResults.manifest;
    const permissions = root['uses-permission'] || [];
    const existing = permissions.find((p) => p.$?.['android:name'] === AD_ID);

    if (existing) {
      existing.$['tools:node'] = 'replace';
    } else {
      permissions.push({
        $: {
          'android:name': AD_ID,
          'tools:node': 'replace',
        },
      });
    }

    root['uses-permission'] = permissions;
    return cfg;
  });
}

module.exports = withAndroidAdIdPermission;
