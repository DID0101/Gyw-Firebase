const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Configure resolver to handle native modules and package exports
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
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
      inlineRequires: true,
    },
  }),
};

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});
