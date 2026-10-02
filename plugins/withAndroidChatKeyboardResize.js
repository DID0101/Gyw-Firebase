/**
 * Ensures chat screens can use native adjustResize (WhatsApp-style):
 * - MainActivity windowSoftInputMode=adjustResize
 * - decor fits system windows BEFORE super.onCreate
 */
const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

const MARKER = 'GYW_CHAT_KEYBOARD_RESIZE';

function patchMainActivity(config) {
  return withMainActivity(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) {
      return cfg;
    }

    const isKotlin =
      cfg.modResults.language === 'kotlin' ||
      contents.includes('class MainActivity : ReactActivity()');

    if (!contents.includes('androidx.core.view.WindowCompat')) {
      if (isKotlin) {
        contents = contents.replace(/^package .+\n/m, (m) => `${m}import androidx.core.view.WindowCompat\n`);
      } else {
        contents = contents.replace(
          /^package .+;\r?\n/m,
          (m) => `${m}\nimport androidx.core.view.WindowCompat;\n`,
        );
      }
    }

    const blockKotlin = `
    // ${MARKER}
    WindowCompat.setDecorFitsSystemWindows(window, true)`;
    const blockJava = `
    // ${MARKER}
    WindowCompat.setDecorFitsSystemWindows(getWindow(), true);`;
    const block = isKotlin ? blockKotlin : blockJava;

    if (contents.includes('super.onCreate(null)')) {
      contents = contents.replace('super.onCreate(null)', `${block}\n    super.onCreate(null)`);
    } else if (contents.includes('super.onCreate(savedInstanceState)')) {
      contents = contents.replace(
        'super.onCreate(savedInstanceState)',
        `${block}\n    super.onCreate(savedInstanceState)`,
      );
    } else {
      console.warn(
        '[withAndroidChatKeyboardResize] Could not inject WindowCompat into MainActivity',
      );
      return cfg;
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

function patchManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app?.activity) {
      return cfg;
    }
    const main = app.activity.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:windowSoftInputMode'] = 'adjustResize';
    }
    return cfg;
  });
}

/** @param {import('@expo/config-plugins').ExpoConfig} config */
module.exports = function withAndroidChatKeyboardResize(config) {
  config = patchManifest(config);
  config = patchMainActivity(config);
  return config;
};
