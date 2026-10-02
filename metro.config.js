const { withNativeWind } = require('nativewind/metro');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Configure resolver to handle native modules and package exports
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
  blockList: [
    ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : []),
    /node_modules[/\\]@react-native-firebase[/\\]database[/\\].*/,
  ],
  // Provide a fallback for react-native-webrtc if not available
  extraNodeModules: {
    ...config.resolver.extraNodeModules,
  },
};

// Configure transformer to handle native modules
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      // inlineRequires: true breaks Hermes release bundles — deferred module IDs
      // (e.g. "2761") are not registered when index.js loads synchronously.
      inlineRequires: false,
    },
  }),
};

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});