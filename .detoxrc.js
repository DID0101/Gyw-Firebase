/**
 * .detoxrc.js
 *
 * Detox configuration for GYW call-flow E2E tests.
 *
 * Bundle IDs
 * ──────────
 *   iOS     com.tropicolx.signal-clone
 *   Android com.gyw1.chat
 *
 * Quick start
 * ───────────
 *   # 1 — install Detox CLI globally (once)
 *   npm install -g detox-cli
 *
 *   # 2 — install dev dependencies
 *   npm install -D detox @types/detox ts-node
 *
 *   # 3 — build the debug app
 *   npx detox build --configuration ios.sim.debug
 *   npx detox build --configuration android.emu.debug
 *
 *   # 4 — run E2E tests
 *   npx detox test --configuration ios.sim.debug
 *   npx detox test --configuration android.emu.debug
 *
 * Simulator / emulator targets
 * ────────────────────────────
 *   iOS     — iPhone 15 Pro (iOS 17.x) — adjust `device.type` below
 *   Android — Pixel 6 API 33 emulator — adjust `avdName` below
 */

/** @type {import('detox').DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120_000,
    },
  },

  apps: {
    'ios.debug': {
      type: 'ios.app',
      // Path produced by `expo run:ios` in debug mode
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/GYW.app',
      build:
        'xcodebuild -workspace ios/gyw.xcworkspace ' +
        '-scheme gyw ' +
        '-configuration Debug ' +
        '-sdk iphonesimulator ' +
        'CONFIGURATION_BUILD_DIR=ios/build/Build/Products/Debug-iphonesimulator ' +
        '| xcpretty',
    },

    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/GYW.app',
      build:
        'xcodebuild -workspace ios/gyw.xcworkspace ' +
        '-scheme gyw ' +
        '-configuration Release ' +
        '-sdk iphonesimulator ' +
        'CONFIGURATION_BUILD_DIR=ios/build/Build/Products/Release-iphonesimulator ' +
        '| xcpretty',
    },

    'android.debug': {
      type: 'android.apk',
      // Path produced by `expo run:android`
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug && cd ..',
      reversePorts: [8081], // Metro bundler
    },

    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build: 'cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release && cd ..',
    },
  },

  devices: {
    'simulator': {
      type: 'ios.simulator',
      device: {
        // Change to the simulator available on your machine.
        // Run: xcrun simctl list devices available
        type: 'iPhone 15 Pro',
        os: 'iOS 17.5',
      },
    },

    'emulator': {
      type: 'android.emulator',
      device: {
        // Run: emulator -list-avds to see available AVDs
        avdName: 'Pixel_6_API_33',
      },
    },

    'attached.android': {
      type: 'android.attached',
      device: {
        adbName: '.*', // matches the first attached device/emulator
      },
    },
  },

  configurations: {
    // ── iOS ──────────────────────────────────────────────────────────────
    'ios.sim.debug': {
      device: 'simulator',
      app:    'ios.debug',
    },

    'ios.sim.release': {
      device: 'simulator',
      app:    'ios.release',
    },

    // ── Android ──────────────────────────────────────────────────────────
    'android.emu.debug': {
      device: 'emulator',
      app:    'android.debug',
    },

    'android.emu.release': {
      device: 'emulator',
      app:    'android.release',
    },

    'android.device.debug': {
      device: 'attached.android',
      app:    'android.debug',
    },
  },
};
