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
  withMainActivity,
} = require('@expo/config-plugins');

/** Injected once after `super.onCreate()` so TelecomManager has a PhoneAccount before any FCM arrives. */
const PHONE_ACCOUNT_MARKER = 'GYW_REGISTER_TELECOM_PHONE_ACCOUNT';
const INCOMING_CALL_PACKAGE_MARKER = 'GYW_INCOMING_CALL_PACKAGE';
const INCOMING_CALL_THEME_MARKER = 'GYW_INCOMING_CALL_THEME_RES';
const MAIN_ACTIVITY_ACCEPT_TRACE_MARKER = 'GYW_MAIN_ACTIVITY_ACCEPT_TRACE';

const RNFB_MSG_SERVICE = 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService';
const RNFB_MSG_RECEIVER = 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver';

const { FIREBASE_BOM } = require('./firebaseSdkVersions');

function patchMainActivityAcceptTrace(config) {
  return withMainActivity(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes(MAIN_ACTIVITY_ACCEPT_TRACE_MARKER)) {
      return cfg;
    }

    const isKotlin =
      cfg.modResults.language === 'kotlin' ||
      contents.includes('class MainActivity : ReactActivity()');

    if (!contents.includes('android.util.Log')) {
      if (isKotlin) {
        contents = contents.replace(/^package .+\n/m, (m) => `${m}import android.util.Log\n`);
      } else {
        contents = contents.replace(/^package .+;\r?\n/m, (m) => `${m}\nimport android.util.Log;\n`);
      }
    }
    if (isKotlin && !contents.includes('import android.content.Intent')) {
      contents = contents.replace(/^package .+\n/m, (m) => `${m}import android.content.Intent\n`);
    } else if (!isKotlin && !contents.includes('import android.content.Intent;')) {
      contents = contents.replace(/^package .+;\r?\n/m, (m) => `${m}\nimport android.content.Intent;\n`);
    }

    const logOnCreate = isKotlin
      ? `
    // ${MAIN_ACTIVITY_ACCEPT_TRACE_MARKER}
    run {
      val i = intent
      Log.w("MainActivity", "MAIN_ACTIVITY_ONCREATE action=" + (i?.action ?: "") + " data=" + (i?.dataString ?: "") + " callId=" + (i?.getStringExtra("callId") ?: ""))
    }`
      : `
    // ${MAIN_ACTIVITY_ACCEPT_TRACE_MARKER}
    {
      Intent i = getIntent();
      Log.w("MainActivity", "MAIN_ACTIVITY_ONCREATE action=" + (i != null ? i.getAction() : "") + " data=" + (i != null && i.getData() != null ? i.getData().toString() : "") + " callId=" + (i != null ? i.getStringExtra("callId") : ""));
    }`;

    if (contents.includes('super.onCreate(null)')) {
      contents = contents.replace('super.onCreate(null)', `${logOnCreate}\n    super.onCreate(null)`);
    } else if (contents.includes('super.onCreate(savedInstanceState)')) {
      contents = contents.replace(
        'super.onCreate(savedInstanceState)',
        `${logOnCreate}\n    super.onCreate(savedInstanceState)`,
      );
    } else {
      console.warn('[withAndroidIncomingCall] Could not inject MainActivity onCreate accept trace');
      return cfg;
    }

    const onNewIntentLog = isKotlin
      ? `setIntent(intent)\n    Log.w("MainActivity", "MAIN_ACTIVITY_ONNEWINTENT action=" + (intent.action ?: "") + " data=" + (intent.dataString ?: "") + " callId=" + (intent.getStringExtra("callId") ?: ""))`
      : `setIntent(intent);\n    Log.w("MainActivity", "MAIN_ACTIVITY_ONNEWINTENT action=" + (intent != null ? intent.getAction() : "") + " data=" + (intent != null && intent.getData() != null ? intent.getData().toString() : "") + " callId=" + (intent != null ? intent.getStringExtra("callId") : ""));`;

    if (contents.includes('fun onNewIntent(') || contents.includes('void onNewIntent(')) {
      if (!contents.includes('MAIN_ACTIVITY_ONNEWINTENT')) {
        contents = contents.replace(
          /(override fun onNewIntent\([^)]*\)[^{]*\{)/,
          `$1\n    // ${MAIN_ACTIVITY_ACCEPT_TRACE_MARKER}\n    ${onNewIntentLog}\n`,
        );
        contents = contents.replace(
          /(protected void onNewIntent\([^)]*\)[^{]*\{)/,
          `$1\n    // ${MAIN_ACTIVITY_ACCEPT_TRACE_MARKER}\n    ${onNewIntentLog}\n`,
        );
      }
    } else if (!contents.includes('MAIN_ACTIVITY_ONNEWINTENT')) {
      const onNewIntentBlock = isKotlin
        ? `
  override fun onNewIntent(intent: Intent) {
    // ${MAIN_ACTIVITY_ACCEPT_TRACE_MARKER}
    ${onNewIntentLog}
    super.onNewIntent(intent)
  }`
        : `
  @Override
  protected void onNewIntent(Intent intent) {
    // ${MAIN_ACTIVITY_ACCEPT_TRACE_MARKER}
    ${onNewIntentLog}
    super.onNewIntent(intent);
  }`;

      contents = contents.replace(/\n}\s*$/, `${onNewIntentBlock}\n}\n`);
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = function withAndroidIncomingCall(config) {
  config = patchMainActivityAcceptTrace(config);
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
        'IncomingCallUiLauncher.java',
        'IncomingCallModule.kt',
        'IncomingCallPackage.kt',
        'IncomingCallBridgeModule.kt',
        'ContactNameCache.kt',
        'CallLatencyTrace.kt',
        'CallerProfileCache.kt',
        'IncomingCallMetadata.kt',
        'IncomingCallAvatarLoader.kt',
        'IncomingCallUiTheme.kt',
        'ChatNotificationBridgeModule.kt',
        'IncomingCallActivity.kt',
        'IncomingCallFcmHandler.kt',
        'IncomingCallReceiver.kt',
        'IncomingCallActionHandler.java',
        'NativeCallStateUpdater.java',
        'GywMessageNotifier.java',
        'GywMessageNotificationActionReceiver.java',
        // New Telecom + Headless files
        'CallConnectionService.kt',
        'HeadlessCallTask.kt',
        'IncomingCallGuard.kt',
        'OemPermissionDiagnostics.kt',
        'IncomingCallPathConfig.java',
        'IncomingCallProcessState.java',
        'IncomingCallDiagnostics.java',
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

      const resRoot = path.join(platformRoot, 'app', 'src', 'main', 'res');
      const drawableSrc = path.join(projectRoot, 'plugins', 'android-native', 'res', 'drawable');
      if (fs.existsSync(drawableSrc)) {
        const drawableDest = path.join(resRoot, 'drawable');
        fs.mkdirSync(drawableDest, { recursive: true });
        for (const name of fs.readdirSync(drawableSrc)) {
          if (name.endsWith('.xml')) {
            fs.copyFileSync(
              path.join(drawableSrc, name),
              path.join(drawableDest, name)
            );
          }
        }
      }

      // ── res/values: incoming-call theme + background color ─────────────────
      const valuesDir = path.join(resRoot, 'values');
      fs.mkdirSync(valuesDir, { recursive: true });
      const colorsPath = path.join(valuesDir, 'colors.xml');
      const colorsMarker = '<!-- gyw-incoming-call-colors -->';
      let colorsXml = fs.existsSync(colorsPath)
        ? fs.readFileSync(colorsPath, 'utf8')
        : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
      if (
        !colorsXml.includes(colorsMarker) &&
        !colorsXml.includes('name="call_background"')
      ) {
        if (!colorsXml.includes('</resources>')) {
          colorsXml = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
        }
        colorsXml = colorsXml.replace(
          '</resources>',
          `  ${colorsMarker}\n  <color name="call_background">#0D1B2A</color>\n</resources>`
        );
        fs.writeFileSync(colorsPath, colorsXml);
      }

      const stylesPath = path.join(valuesDir, 'styles.xml');
      const stylesMarker = '<!-- gyw-incoming-call-theme -->';
      let stylesXml = fs.existsSync(stylesPath)
        ? fs.readFileSync(stylesPath, 'utf8')
        : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
      if (
        !stylesXml.includes(stylesMarker) &&
        !stylesXml.includes('Theme.App.IncomingCall')
      ) {
        if (!stylesXml.includes('</resources>')) {
          stylesXml = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
        }
        stylesXml = stylesXml.replace(
          '</resources>',
          `  ${stylesMarker}\n  <style name="Theme.App.IncomingCall" parent="Theme.AppCompat.NoActionBar">\n    <item name="android:windowBackground">@color/call_background</item>\n    <item name="android:statusBarColor">@android:color/transparent</item>\n    <item name="android:windowTranslucentStatus">true</item>\n  </style>\n</resources>`
        );
        fs.writeFileSync(stylesPath, stylesXml);
      }

      const rawDestDir = path.join(resRoot, 'raw');
      fs.mkdirSync(rawDestDir, { recursive: true });

      const ringtoneSrc = path.join(projectRoot, 'assets', 'sounds', 'ringtone.wav');
      if (fs.existsSync(ringtoneSrc)) {
        fs.copyFileSync(ringtoneSrc, path.join(rawDestDir, 'ringtone.wav'));
        console.log('[withAndroidIncomingCall] copied ringtone.wav → res/raw/ringtone.wav');
      } else {
        console.warn(
          '[withAndroidIncomingCall] assets/sounds/ringtone.wav missing — incoming calls will use system default ringtone'
        );
      }

      const messageSoundSrc = path.join(projectRoot, 'assets', 'sounds', 'message_sound.wav');
      if (fs.existsSync(messageSoundSrc)) {
        fs.copyFileSync(messageSoundSrc, path.join(rawDestDir, 'message_sound.wav'));
        console.log(
          '[withAndroidIncomingCall] copied message_sound.wav → res/raw/message_sound.wav'
        );
      } else {
        console.warn(
          '[withAndroidIncomingCall] assets/sounds/message_sound.wav missing — chat notifications will use system default sound'
        );
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
    implementation "com.google.firebase:firebase-messaging"
    implementation "com.google.firebase:firebase-auth"
    implementation "com.google.firebase:firebase-firestore"`
      );
    }
    for (const dep of [
      'implementation "com.google.firebase:firebase-auth"',
      'implementation "com.google.firebase:firebase-firestore"',
    ]) {
      if (!contents.includes(dep)) {
        contents = contents.replace(
          /implementation "com\.google\.firebase:firebase-messaging"\s*/,
          (m) => `${m}    ${dep}\n`
        );
      }
    }

    // ── compileSdk / targetSdk 36 ────────────────────────────────────────────
    // FOREGROUND_SERVICE_TYPE_PHONE_CALL + USE_FULL_SCREEN_INTENT API 34+ paths
    // require compileSdk ≥ 34.  Play requires targetSdk 36 from Aug 31, 2026.
    const compileSdkMarker = 'gyw-compile-sdk-36';
    if (!contents.includes(compileSdkMarker)) {
      // Replace compileSdkVersion / compileSdk if below 36
      contents = contents.replace(
        /compileSdkVersion\s+\d+/g,
        'compileSdkVersion 36'
      ).replace(
        /compileSdk\s+=?\s*\d+/g,
        `compileSdk = 36 // ${compileSdkMarker}`
      );
      contents = contents.replace(
        /targetSdkVersion\s+\d+/g,
        'targetSdkVersion 36'
      ).replace(
        /targetSdk\s+=?\s*\d+/g,
        'targetSdk = 36'
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
      'android.permission.RECEIVE_BOOT_COMPLETED',
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

    const incomingDeclineReceiverRel = '.IncomingCallReceiver';
    if (
      !app.receiver.some(
        (r) =>
          r.$?.['android:name'] === incomingDeclineReceiverRel ||
          String(r.$?.['android:name'] || '').endsWith('IncomingCallReceiver')
      )
    ) {
      app.receiver.push({
        $: {
          'android:name': incomingDeclineReceiverRel,
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'ACTION_DECLINE_CALL' } }],
          },
        ],
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

    // MainActivity must NOT use showWhenLocked/turnScreenOn — breaks Firebase RecaptchaActivity
    // Keystore on Tecno/Oppo/Xiaomi (encryption key error). Lock-screen flags belong on IncomingCallActivity only.
    const activities = app.activity || [];

    const incomingActivityRel = '.IncomingCallActivity';
    let incomingActivity = activities.find((a) => a.$?.['android:name'] === incomingActivityRel);
    if (!incomingActivity) {
      incomingActivity = { $: { 'android:name': incomingActivityRel } };
      activities.push(incomingActivity);
    }
    incomingActivity.$['android:exported'] = 'true';
    incomingActivity.$['android:theme'] = '@style/Theme.App.IncomingCall';
    incomingActivity.$['android:showWhenLocked'] = 'true';
    incomingActivity.$['android:showOnLockScreen'] = 'true';
    incomingActivity.$['android:turnScreenOn'] = 'true';
    incomingActivity.$['android:excludeFromRecents'] = 'true';
    incomingActivity.$['android:launchMode'] = 'singleTask';
    incomingActivity.$['android:taskAffinity'] = `${androidPackage}.incomingcall`;
    app.activity = activities;

    return cfg;
  });

  // ── Application.onCreate: PhoneAccount + IncomingCallPackage ───────────────
  config = withMainApplication(config, (cfg) => {
    const androidPackage = cfg.android?.package ?? 'com.gyw1.chat';
    let contents = cfg.modResults.contents;
    const isKotlin = cfg.modResults.language === 'kotlin';

    if (!contents.includes('CallConnectionService')) {
      const importLine = isKotlin
        ? `import ${androidPackage}.CallConnectionService\nimport ${androidPackage}.IncomingCallPackage`
        : `import ${androidPackage}.CallConnectionService;\nimport ${androidPackage}.IncomingCallPackage;`;
      if (isKotlin) {
        contents = contents.replace(/^package .+\n/m, (m) => `${m}\n${importLine}\n`);
      } else {
        contents = contents.replace(/^package .+;\r?\n/m, (m) => `${m}\n${importLine}\n`);
      }
    } else if (!contents.includes('IncomingCallPackage')) {
      const pkgImport = isKotlin
        ? `import ${androidPackage}.IncomingCallPackage`
        : `import ${androidPackage}.IncomingCallPackage;`;
      if (isKotlin) {
        contents = contents.replace(/^package .+\n/m, (m) => `${m}\n${pkgImport}\n`);
      } else {
        contents = contents.replace(/^package .+;\r?\n/m, (m) => `${m}\n${pkgImport}\n`);
      }
    }

    if (!contents.includes(PHONE_ACCOUNT_MARKER)) {
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
      if (isKotlin) {
        contents = contents.replace(/super\.onCreate\(\)\s*\n/, `super.onCreate()${kotlinBlock}\n`);
      } else {
        contents = contents.replace(/super\.onCreate\(\);\s*\r?\n/, `super.onCreate();${javaBlock}\n`);
      }
    }

    if (!contents.includes(INCOMING_CALL_PACKAGE_MARKER)) {
      if (isKotlin) {
        if (contents.includes('PackageList(this).packages.apply')) {
          contents = contents.replace(
            /PackageList\(this\)\.packages\.apply\s*\{/,
            `$&\n              // ${INCOMING_CALL_PACKAGE_MARKER}\n              add(IncomingCallPackage())`
          );
        } else if (
          /val packages = PackageList\(this\)\.packages/.test(contents) &&
          !contents.includes('add(IncomingCallPackage())')
        ) {
          contents = contents.replace(
            /(val packages = PackageList\(this\)\.packages\s*\n)/,
            `$1            // ${INCOMING_CALL_PACKAGE_MARKER}\n            packages.add(IncomingCallPackage())\n`
          );
        } else if (contents.includes('override fun getPackages()')) {
          contents = contents.replace(
            /override fun getPackages\(\): List<ReactPackage>\s*\{/,
            `$&\n    // ${INCOMING_CALL_PACKAGE_MARKER}\n    val packages = PackageList(this).packages\n    packages.add(IncomingCallPackage())\n    return packages`
          );
        }
      } else {
        contents = contents.replace(
          /new PackageList\(this\)\.getPackages\(\)/,
          `new PackageList(this).getPackages() /* ${INCOMING_CALL_PACKAGE_MARKER} patched below */`
        );
        if (!contents.includes('packages.add(new IncomingCallPackage())')) {
          contents = contents.replace(
            /List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);/,
            `List<ReactPackage> packages = new PackageList(this).getPackages();\n    // ${INCOMING_CALL_PACKAGE_MARKER}\n    packages.add(new IncomingCallPackage());`
          );
        }
      }
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

  return config;
};
