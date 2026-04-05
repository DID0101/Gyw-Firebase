/**
 * Notifee resolves app.notifee:core from a local Maven repo under node_modules.
 * That repository must be listed in android/build.gradle before Gradle resolves
 * dependencies; otherwise :app fails with "Could not find app.notifee:core:+".
 *
 * @see https://notifee.app/react-native/docs/installation#android
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const MARKER = '@notifee/react-native/android/libs';

module.exports = function withNotifeeMavenRepo(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const buildGradlePath = path.join(root, 'build.gradle');
      if (!fs.existsSync(buildGradlePath)) {
        return cfg;
      }
      let contents = fs.readFileSync(buildGradlePath, 'utf8');
      if (contents.includes(MARKER)) {
        return cfg;
      }

      const needle = 'allprojects {';
      const start = contents.indexOf(needle);
      if (start === -1) return cfg;

      const reposLabel = 'repositories {';
      const reposIdx = contents.indexOf(reposLabel, start);
      if (reposIdx === -1) return cfg;

      const openBrace = contents.indexOf('{', reposIdx);
      if (openBrace === -1) return cfg;

      const insertAt = openBrace + 1;
      const block = `
    maven {
      url "$rootDir/../node_modules/@notifee/react-native/android/libs"
    }
`;
      contents = contents.slice(0, insertAt) + block + contents.slice(insertAt);
      fs.writeFileSync(buildGradlePath, contents);
      return cfg;
    },
  ]);
};
