// Order matters for Android Headless JS + @react-native-firebase/messaging:
// 1) silence flag before any RN Firebase native init
// 2) register background handler before expo-router/entry (AppRegistry)

if (typeof globalThis !== 'undefined') {
  globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
}

require('./lib/registerBackgroundMessaging');

require('expo-router/entry');
