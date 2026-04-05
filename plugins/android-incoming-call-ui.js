/**
 * Incoming calls: MainActivity manifest flags for lock-screen / full-screen intent.
 *
 * MainActivity.kt must call applyIncomingCallWindowFlagsIfNeeded() for deep links (see repo
 * android/app/.../MainActivity.kt). `expo prebuild --clean` resets that file — restore from git
 * or re-apply the incoming-call block.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

function addMainActivityLockScreenAttrs(manifest) {
  const root = manifest?.manifest ?? manifest;
  if (!root?.application) return false;
  const apps = Array.isArray(root.application) ? root.application : [root.application];
  let changed = false;
  for (const app of apps) {
    const activities = app.activity;
    if (!activities) continue;
    const list = Array.isArray(activities) ? activities : [activities];
    for (const act of list) {
      const name = act?.$?.['android:name'];
      if (name !== '.MainActivity' && name !== 'com.gyw1.chat.MainActivity') continue;
      act.$ = act.$ || {};
      if (!act.$['android:showWhenLocked']) {
        act.$['android:showWhenLocked'] = 'true';
        changed = true;
      }
      if (!act.$['android:turnScreenOn']) {
        act.$['android:turnScreenOn'] = 'true';
        changed = true;
      }
    }
  }
  return changed;
}

module.exports = function withAndroidIncomingCallUi(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    addMainActivityLockScreenAttrs(manifest);
    return cfg;
  });
};
