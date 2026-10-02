/**
 * Exclude orphaned @react-native-firebase/database (not in package.json).
 * Stale node_modules copy breaks Metro with missing ./query export.
 */
module.exports = {
  dependencies: {
    '@react-native-firebase/database': {
      platforms: {
        android: null,
        ios: null,
      },
    },
  },
};
