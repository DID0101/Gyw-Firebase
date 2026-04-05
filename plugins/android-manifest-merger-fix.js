// Ensures app's meta-data wins over @react-native-firebase/messaging during manifest merge.
// Without this, Gradle can fail with:
// Attribute meta-data#com.google.firebase.messaging.default_notification_color ... is also present at [:react-native-firebase_messaging]

const { withAndroidManifest } = require('@expo/config-plugins');

const META_NAME = 'com.google.firebase.messaging.default_notification_color';

function ensureArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function setToolsReplace(metaData) {
  metaData.$ = metaData.$ || {};
  const existing = metaData.$['tools:replace'];
  if (!existing) {
    metaData.$['tools:replace'] = 'android:resource';
    return;
  }
  const parts = String(existing)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.includes('android:resource')) {
    parts.push('android:resource');
    metaData.$['tools:replace'] = parts.join(',');
  }
}

function patchFirebaseNotificationMetaInApplication(application) {
  if (!application) return false;
  const apps = ensureArray(application);
  let changed = false;
  for (const app of apps) {
    const metaArrayRaw = app['meta-data'] ?? app['metaData'];
    if (!metaArrayRaw) continue;
    const normalized = ensureArray(metaArrayRaw);
    app['meta-data'] = normalized;

    const meta = normalized.find((m) => {
      const attrs = m?.$ ?? {};
      const direct = attrs['android:name'] ?? attrs['name'];
      if (direct === META_NAME) return true;
      return Object.entries(attrs).some(([k, v]) => k.endsWith(':name') && String(v) === META_NAME);
    });

    if (meta) {
      setToolsReplace(meta);
      changed = true;
    }
  }
  return changed;
}

module.exports = function androidManifestMergerFix(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    // Parsed shape varies: full doc under .manifest or top-level application
    const root = manifest?.manifest ?? manifest;
    if (!root) return cfg;

    const applications = root.application;
    if (applications) {
      patchFirebaseNotificationMetaInApplication(applications);
      return cfg;
    }

    // Rare: application at top of modResults
    if (manifest.application) {
      patchFirebaseNotificationMetaInApplication(manifest.application);
    }
    return cfg;
  });
};

