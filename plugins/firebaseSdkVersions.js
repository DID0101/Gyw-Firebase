/** @react-native-firebase/app sdkVersions — keep app-level BOM aligned with RNFB modules. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rnfbApp = require('@react-native-firebase/app/package.json');

module.exports = {
  FIREBASE_BOM: rnfbApp.sdkVersions?.android?.firebase ?? '34.10.0',
};
