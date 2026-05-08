/**
 * plugins/withAndroidIncomingCall.js
 *
 * Expo config plugin for incoming calls on Android:
 *
 *  - Permissions: USE_FULL_SCREEN_INTENT, FOREGROUND_SERVICE_PHONE_CALL, MANAGE_OWN_CALLS
 *  - MainActivity: showWhenLocked + turnScreenOn
 *  - GywFirebaseMessagingService: replaces RN Firebase's no-op onMessageReceived — handles
 *    FCM data when the app is killed, shows incoming_call via GywIncomingCallNotifier
 *    (full-screen PendingIntent). Other messages mirror ReactNativeFirebaseMessagingReceiver.
 *  - Removes RN Firebase's default MessagingService + c2dm Receiver (merge) so only our
 *    service handles MESSAGING_EVENT (avoids duplicate headless tasks).
 *
 * Android call pushes: data-only + high priority (see callPushHandler).
 *
 * Run after changes:
 *   npx expo prebuild --clean
 */

const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withAppBuildGradle,
  withMainApplication,
} = require('@expo/config-plugins');

/** Injected once after `super.onCreate()` so TelecomManager has a PhoneAccount before any FCM arrives. */
const PHONE_ACCOUNT_MARKER = 'GYW_REGISTER_TELECOM_PHONE_ACCOUNT';

const RNFB_MSG_SERVICE = 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService';
const RNFB_MSG_RECEIVER = 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver';

/** Must stay aligned with @react-native-firebase/app `sdkVersions.android.firebase` (BOM). */
const FIREBASE_BOM = '34.8.0';

module.exports = function withAndroidIncomingCall(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const androidPackage = cfg.android?.package ?? 'com.gyw1.chat';
      const destDir = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        ...androidPackage.split('.')
      );
      fs.mkdirSync(destDir, { recursive: true });
      const srcDir = path.join(projectRoot, 'plugins', 'android-native', 'com', 'gyw1', 'chat');
      const files = [
        'GywCallNotificationActionReceiver.java',
        // GywFirebaseMessagingService.kt supersedes the old .java — copy Kotlin version only
        'GywFirebaseMessagingService.kt',
        'GywIncomingCallAlerts.java',
        'GywIncomingCallNotifier.java',
        'GywIncomingCallService.java',
        'IncomingCallBridgeModule.kt',
        'IncomingCallBridgePackage.kt',
        'ChatNotificationBridgeModule.kt',
        'IncomingCallActivity.kt',
        'IncomingCallActionHandler.java',
        'GywMessageNotifier.java',
        'GywMessageNotificationActionReceiver.java',
        // New Telecom + Headless files
        'CallConnectionService.kt',
        'HeadlessCallTask.kt',
        'IncomingCallGuard.kt',
      ];
      for (const f of files) {
        const srcPath = path.join(srcDir, f);
        if (!fs.existsSync(srcPath)) continue;
        let text = fs.readFileSync(srcPath, 'utf8');
        // Fix package declaration — .java uses semicolon, .kt does not
        text = text.replace(/^package com\.gyw1\.chat;/m, `package ${androidPackage};`);
        text = text.replace(/^package com\.gyw1\.chat$/m, `package ${androidPackage}`);
        fs.writeFileSync(path.join(destDir, f), text);
      }
      return cfg;
    },
  ]);

  config = withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    // ── Firebase BOM + messaging ─────────────────────────────────────────────
    const fcmMarker = 'gyw-firebase-messaging-app-compile';
    if (!contents.includes(fcmMarker)) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {
    // ${fcmMarker}: GywFirebaseMessagingService needs FCM classes on app compile classpath
    implementation platform("com.google.firebase:firebase-bom:${FIREBASE_BOM}")
    implementation "com.google.firebase:firebase-messaging"`
      );
    }

    // ── compileSdk / targetSdk 35 ────────────────────────────────────────────
    // FOREGROUND_SERVICE_TYPE_PHONE_CALL + USE_FULL_SCREEN_INTENT API 34+ paths
    // require compileSdk ≥ 34.  35 is the current stable target.
    const compileSdkMarker = 'gyw-compile-sdk-35';
    if (!contents.includes(compileSdkMarker)) {
      // Replace compileSdkVersion / compileSdk if below 34
      contents = contents.replace(
        /compileSdkVersion\s+\d+/g,
        'compileSdkVersion 35'
      ).replace(
        /compileSdk\s+=?\s*\d+/g,
        `compileSdk = 35 // ${compileSdkMarker}`
      );
      contents = contents.replace(
        /targetSdkVersion\s+\d+/g,
        'targetSdkVersion 35'
      ).replace(
        /targetSdk\s+=?\s*\d+/g,
        'targetSdk = 35'
      );
    }

    // ── Kotlin: ensure kotlin-android plugin is applied ───────────────────────
    // Expo projects already include Kotlin; this is a safety guard.
    const kotlinMarker = 'gyw-kotlin-android';
    if (!contents.includes(kotlinMarker) && !contents.includes("id 'kotlin-android'") && !contents.includes('id("kotlin-android")')) {
      contents = contents.replace(
        /apply plugin: ['"]com\.android\.application['"]/,
        `apply plugin: 'com.android.application'\napply plugin: 'kotlin-android' // ${kotlinMarker}`
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];
    const androidPackage = cfg.android?.package ?? 'com.gyw1.chat';
    const ourServiceName = `${androidPackage}.GywFirebaseMessagingService`;

    // ── Permissions ──────────────────────────────────────────────────────────
    const permissions = manifest.manifest['uses-permission'] || [];
    const newPerms = [
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.FOREGROUND_SERVICE',                  // required on Android 9+ to call startForeground() at all
      'android.permission.FOREGROUND_SERVICE_PHONE_CALL',       // required on Android 14+ for foregroundServiceType=phoneCall
      'android.permission.MANAGE_OWN_CALLS',                   // auto-grants USE_FULL_SCREEN_INTENT on Android 14+
      'android.permission.WAKE_LOCK',                          // required for WakeLock (screen wakeup on incoming call)
      'android.permission.VIBRATE',                            // required for notification vibration on some API levels
      'android.permission.POST_NOTIFICATIONS',                  // Android 13+: heads-up + full-screen intent eligibility
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', // battery exemption dialog in MainActivity
    ];
    for (const perm of newPerms) {
      if (!permissions.some((p) => p.$?.['android:name'] === perm)) {
        permissions.push({ $: { 'android:name': perm } });
      }
    }
    manifest.manifest['uses-permission'] = permissions;

    // ── Remove stale service / receiver declarations ──────────────────────────
    const deadServices = ['.VoIPMessagingService', '.IncomingCallService'];
    if (app.service) {
      app.service = app.service.filter(
        (s) => !deadServices.includes(s.$?.['android:name'])
      );
    }

    const deadReceivers = ['.IncomingCallReceiver'];
    if (app.receiver) {
      app.receiver = app.receiver.filter(
        (r) => !deadReceivers.includes(r.$?.['android:name'])
      );
    }

    // Drop legacy GywFcmCallReceiver if present (c2dm path is unreliable for FCM data).
    if (app.receiver) {
      app.receiver = app.receiver.filter((r) => {
        const n = String(r.$?.['android:name'] || '');
        return !n.endsWith('.GywFcmCallReceiver') && n !== 'com.gyw1.chat.GywFcmCallReceiver';
      });
    }

    // Remove RN Firebase messaging components; our GywFirebaseMessagingService replaces them.
    app.service = app.service || [];
    if (!app.service.some((s) => s.$?.['android:name'] === RNFB_MSG_SERVICE && s.$?.['tools:node'] === 'remove')) {
      app.service.push({
        $: { 'android:name': RNFB_MSG_SERVICE, 'tools:node': 'remove' },
      });
    }
    if (!app.service.some((s) => s.$?.['android:name'] === ourServiceName)) {
      app.service.push({
        $: {
          'android:name': ourServiceName,
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }],
          },
        ],
      });
    }

    // ── READ_PHONE_NUMBERS (runtime on API 30+, needed by TelecomManager) ─────
    const phonePerm = 'android.permission.READ_PHONE_NUMBERS';
    if (!permissions.some((p) => p.$?.['android:name'] === phonePerm)) {
      permissions.push({ $: { 'android:name': phonePerm } });
    }

    // ── GywIncomingCallService (phone-call foreground service) ───────────────
    // Starts from GywFirebaseMessagingService on the lock-screen path: WakeLock + FGS +
    // full-screen PendingIntent to IncomingCallActivity (no duplicate MainActivity launch).
    const callServiceName = `${androidPackage}.GywIncomingCallService`;
    if (!app.service.some((s) => s.$?.['android:name'] === callServiceName)) {
      const callServiceEntry = {
        $: {
          'android:name': callServiceName,
          'android:exported': 'false',
          'android:stopWithTask': 'false',
        },
      };
      // foregroundServiceType requires compileSdk 29+. Add the attribute conditionally
      // so the manifest is valid even on projects targeting older compile SDKs.
      callServiceEntry.$['android:foregroundServiceType'] = 'phoneCall';
      app.service.push(callServiceEntry);
    }

    app.receiver = app.receiver || [];
    if (!app.receiver.some((r) => r.$?.['android:name'] === RNFB_MSG_RECEIVER && r.$?.['tools:node'] === 'remove')) {
      app.receiver.push({
        $: { 'android:name': RNFB_MSG_RECEIVER, 'tools:node': 'remove' },
      });
    }

    const callActionReceiverRel = '.GywCallNotificationActionReceiver';
    if (
      !app.receiver.some(
        (r) =>
          r.$?.['android:name'] === callActionReceiverRel ||
          String(r.$?.['android:name'] || '').endsWith('GywCallNotificationActionReceiver')
      )
    ) {
      app.receiver.push({
        $: {
          'android:name': callActionReceiverRel,
          'android:exported': 'false',
        },
      });
    }

    const messageActionReceiverRel = '.GywMessageNotificationActionReceiver';
    if (
      !app.receiver.some(
        (r) =>
          r.$?.['android:name'] === messageActionReceiverRel ||
          String(r.$?.['android:name'] || '').endsWith('GywMessageNotificationActionReceiver')
      )
    ) {
      app.receiver.push({
        $: {
          'android:name': messageActionReceiverRel,
          'android:exported': 'false',
        },
      });
    }

    // ── react-native-callkeep VoiceConnectionService ─────────────────────────
    // RNCallKeep.setup() registers a PhoneAccount whose handle points at this class.
    // Without this <service>, Telecom throws: PhoneAccount connection service requires
    // BIND_TELECOM_CONNECTION_SERVICE (handle resolves to a component not exported for Telecom).
    const voiceConnectionService = 'io.wazo.callkeep.VoiceConnectionService';
    if (!app.service.some((s) => s.$?.['android:name'] === voiceConnectionService)) {
      app.service.push({
        $: {
          'android:name': voiceConnectionService,
          'android:exported': 'true',
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] },
        ],
      });
    }

    // ── CallConnectionService (TelecomManager self-managed) ─────────────────
    // Declared with android:permission=BIND_TELECOM_CONNECTION_SERVICE so only
    // the OS Telecom subsystem can bind to it (no third-party access).
    const connectionServiceName = `${androidPackage}.CallConnectionService`;
    if (!app.service.some((s) => s.$?.['android:name'] === connectionServiceName)) {
      app.service.push({
        $: {
          'android:name':       connectionServiceName,
          'android:exported':   'true',
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] },
        ],
      });
    }

    // ── HeadlessCallTask (HeadlessJsTaskService for JS bridge when app killed) ─
    const headlessTaskName = `${androidPackage}.HeadlessCallTask`;
    if (!app.service.some((s) => s.$?.['android:name'] === headlessTaskName)) {
      app.service.push({
        $: {
          'android:name':     headlessTaskName,
          'android:exported': 'false',
        },
      });
    }

    // ── MainActivity: showWhenLocked + turnScreenOn ──────────────────────────
    // ── IncomingCallActivity: full-screen intent target (lock screen) ─────────
    const activities = app.activity || [];
    const mainActivity = activities.find(
      (a) => a.$?.['android:name'] === '.MainActivity'
    );
    if (mainActivity) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
    }

    const incomingActivityRel = '.IncomingCallActivity';
    if (!activities.some((a) => a.$?.['android:name'] === incomingActivityRel)) {
      activities.push({
        $: {
          'android:name': incomingActivityRel,
          'android:exported': 'true',
          'android:theme': '@style/Theme.AppCompat.Light.NoActionBar',
          'android:showOnLockScreen': 'true',
          'android:turnScreenOn': 'true',
          'android:excludeFromRecents': 'true',
          'android:launchMode': 'singleTop',
        },
      });
    }
    app.activity = activities;

    return cfg;
  });

  // ── Application.onCreate: register self-managed PhoneAccount for CallKeep / Telecom ──
  config = withMainApplication(config, (cfg) => {
    const androidPackage = cfg.android?.package ?? 'com.gyw1.chat';
    let contents = cfg.modResults.contents;
    if (contents.includes(PHONE_ACCOUNT_MARKER)) {
      cfg.modResults.contents = contents;
      return cfg;
    }

    const importLine =
      cfg.modResults.language === 'kotlin'
        ? `import ${androidPackage}.CallConnectionService`
        : `import ${androidPackage}.CallConnectionService;`;

    if (!contents.includes('CallConnectionService')) {
      if (cfg.modResults.language === 'kotlin') {
        contents = contents.replace(/^package .+\n/m, (m) => `${m}\n${importLine}\n`);
      } else {
        contents = contents.replace(/^package .+;\r?\n/m, (m) => `${m}\n${importLine}\n`);
      }
    }

    const kotlinBlock = `
    // ${PHONE_ACCOUNT_MARKER}
    try {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        CallConnectionService.registerPhoneAccount(this)
      }
    } catch (_: Throwable) { }
`;

    const javaBlock = `
    // ${PHONE_ACCOUNT_MARKER}
    try {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
        CallConnectionService.registerPhoneAccount(this);
      }
    } catch (Throwable ignored) { }
`;

    if (cfg.modResults.language === 'kotlin') {
      contents = contents.replace(/super\.onCreate\(\)\s*\n/, `super.onCreate()${kotlinBlock}\n`);
    } else {
      contents = contents.replace(/super\.onCreate\(\);\s*\r?\n/, `super.onCreate();${javaBlock}\n`);
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

  return config;
};
