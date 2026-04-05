/**
 * GywCallService (phone-call foreground service) + GywCallPackage registration.
 * Writes Java sources under com.gyw1.chat and patches MainApplication.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const PKG = 'com.gyw1.chat';
const JAVA_DIR = ['app', 'src', 'main', 'java', 'com', 'gyw1', 'chat'];

function ensureUsesPermission(modResults, name) {
  const root = modResults.manifest ?? modResults;
  let list = root['uses-permission'];
  if (!list) {
    list = [];
    root['uses-permission'] = list;
  }
  const arr = Array.isArray(list) ? list : [list];
  const exists = arr.some((p) => p.$['android:name'] === name);
  if (exists) return;
  arr.push({ $: { 'android:name': name } });
  root['uses-permission'] = arr;
}

function ensureService(modResults) {
  const root = modResults.manifest ?? modResults;
  const apps = Array.isArray(root.application) ? root.application : [root.application];
  const invertase = 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService';

  function svcName(s) {
    return s.$ && s.$['android:name'];
  }

  for (const app of apps) {
    if (!app) continue;
    let svcs = app.service;
    if (!svcs) {
      svcs = [];
      app.service = svcs;
    }
    let arr = Array.isArray(svcs) ? svcs : [svcs];

    const gywCallExists = arr.some(
      (s) => svcName(s) === '.GywCallService' || svcName(s) === `${PKG}.GywCallService`
    );
    if (!gywCallExists) {
      arr.push({
        $: {
          'android:name': '.GywCallService',
          'android:foregroundServiceType': 'phoneCall',
          'android:exported': 'false',
          'android:stopWithTask': 'false',
        },
      });
    }

    arr = arr.filter((s) => {
      const n = svcName(s);
      if (n === '.GywFcmService' || n === `${PKG}.GywFcmService`) return false;
      if (n === invertase) return false;
      return true;
    });

    arr.push({
      $: {
        'android:name': '.GywFcmService',
        'android:exported': 'false',
        'tools:replace': 'android:exported',
      },
      'intent-filter': [
        {
          $: { 'android:priority': '100' },
          action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }],
        },
      ],
    });

    arr.push({
      $: {
        'android:name': invertase,
        'tools:node': 'remove',
      },
    });

    app.service = arr;
  }
}

function writeJavaFiles(javaRoot) {
  fs.mkdirSync(javaRoot, { recursive: true });
  fs.writeFileSync(path.join(javaRoot, 'GywCallService.java'), GYW_CALL_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(javaRoot, 'GywDebugTrace.java'), GYW_DEBUG_TRACE_JAVA, 'utf8');
  fs.writeFileSync(path.join(javaRoot, 'GywFcmService.java'), GYW_FCM_SERVICE_JAVA, 'utf8');
  fs.writeFileSync(path.join(javaRoot, 'GywCallModule.java'), GYW_CALL_MODULE_JAVA, 'utf8');
  fs.writeFileSync(path.join(javaRoot, 'GywCallPackage.java'), GYW_CALL_PACKAGE_JAVA, 'utf8');
}

function patchMainApplication(androidRoot) {
  const rel = path.join('app', 'src', 'main', 'java', 'com', 'gyw1', 'chat');
  const dir = path.join(androidRoot, rel);
  const kt = path.join(dir, 'MainApplication.kt');
  const java = path.join(dir, 'MainApplication.java');
  const target = fs.existsSync(kt) ? kt : fs.existsSync(java) ? java : null;
  if (!target) return;

  let text = fs.readFileSync(target, 'utf8');
  if (text.includes('GywCallPackage')) return;

  if (target.endsWith('.kt')) {
    if (!text.includes('GywCallPackage')) {
      if (!text.includes('\nimport com.gyw1.chat.GywCallPackage')) {
        text = text.replace(
          /^(package com\.gyw1\.chat\s*\n)/m,
          `$1\nimport com.gyw1.chat.GywCallPackage\n`
        );
      }
      text = text.replace(
        /val packages = PackageList\(this\)\.packages\s*\n/,
        'val packages = PackageList(this).packages.toMutableList()\n            packages.add(GywCallPackage())\n'
      );
    }
  } else {
    if (!text.includes('import com.gyw1.chat.GywCallPackage;')) {
      text = text.replace(
        /^(package com\.gyw1\.chat;\s*\n)/m,
        `$1import com.gyw1.chat.GywCallPackage;\n`
      );
    }
    text = text.replace(
      /(List<ReactPackage> packages = new PackageList\(this\)\.getPackages\(\);?\s*\n)/,
      `$1    packages.add(new GywCallPackage());\n`
    );
    if (!text.includes('GywCallPackage()')) {
      text = text.replace(/(return packages;)/, `    packages.add(new GywCallPackage());\n    $1`);
    }
  }

  fs.writeFileSync(target, text, 'utf8');
}

function patchAppGradle(androidRoot) {
  const p = path.join(androidRoot, 'app', 'build.gradle');
  if (!fs.existsSync(p)) return;
  let text = fs.readFileSync(p, 'utf8');
  if (text.includes('GywFcmService (app Java)')) return;
  const anchor = 'implementation("com.facebook.react:react-android")';
  if (!text.includes(anchor)) return;
  const insert = `
    // GywFcmService (app Java) compiles against Firebase + RN Firebase messaging APIs
    implementation platform("com.google.firebase:firebase-bom:34.8.0")
    implementation "com.google.firebase:firebase-messaging"
    implementation project(":react-native-firebase_messaging")`;
  text = text.replace(anchor, `${anchor}\n${insert}`);
  fs.writeFileSync(p, text, 'utf8');
}

/** Expo sets platformProjectRoot to repo root or to ./android; never double-append android. */
function resolveAndroidRoot(platformProjectRoot) {
  if (!platformProjectRoot) return path.join(process.cwd(), 'android');
  if (fs.existsSync(path.join(platformProjectRoot, 'settings.gradle'))) {
    return platformProjectRoot;
  }
  const child = path.join(platformProjectRoot, 'android');
  if (fs.existsSync(path.join(child, 'settings.gradle'))) {
    return child;
  }
  return child;
}

module.exports = function withAndroidCallService(config) {
  config = withAndroidManifest(config, (cfg) => {
    const modResults = cfg.modResults;
    ensureUsesPermission(modResults, 'android.permission.USE_FULL_SCREEN_INTENT');
    ensureUsesPermission(modResults, 'android.permission.FOREGROUND_SERVICE');
    ensureUsesPermission(modResults, 'android.permission.FOREGROUND_SERVICE_PHONE_CALL');
    ensureUsesPermission(modResults, 'android.permission.VIBRATE');
    ensureUsesPermission(modResults, 'android.permission.WAKE_LOCK');
    ensureService(modResults);
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const androidRoot = resolveAndroidRoot(cfg.modRequest.platformProjectRoot);
      const javaRoot = path.join(androidRoot, ...JAVA_DIR);
      writeJavaFiles(javaRoot);
      patchMainApplication(androidRoot);
      patchAppGradle(androidRoot);
      return cfg;
    },
  ]);

  return config;
};

const GYW_CALL_SERVICE_JAVA = `package ${PKG};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

public class GywCallService extends Service {
  public static final String ACTION_INCOMING = "${PKG}.GYW_INCOMING_CALL";
  public static final String ACTION_STOP = "${PKG}.GYW_STOP_CALL";
  public static final String EXTRA_CALL_ID = "callId";
  public static final String EXTRA_CALLER_NAME = "callerName";
  public static final String EXTRA_CALL_TYPE = "callType";

  private static final String CHANNEL_ID = "gyw_incoming_calls_v3";
  private static final int NOTIFICATION_ID = 0x475957;

  private Vibrator vibrator;

  @Override
  public void onCreate() {
    super.onCreate();
    createChannel();
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(
      CHANNEL_ID,
      "Incoming calls",
      NotificationManager.IMPORTANCE_HIGH
    );
    ch.setDescription("Incoming calls");
    ch.enableVibration(true);
    ch.setBypassDnd(true);
    ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    nm.createNotificationChannel(ch);
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null) return START_NOT_STICKY;
    String action = intent.getAction();
    if (ACTION_STOP.equals(action)) {
      cancelVibration();
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
      stopSelf();
      return START_NOT_STICKY;
    }
    if (ACTION_INCOMING.equals(action)) {
      String callId = intent.getStringExtra(EXTRA_CALL_ID);
      String callerName = intent.getStringExtra(EXTRA_CALLER_NAME);
      String callType = intent.getStringExtra(EXTRA_CALL_TYPE);
      if (callId == null) {
        stopSelf();
        return START_NOT_STICKY;
      }
      startRinging(callId, callerName != null ? callerName : "Unknown", callType != null ? callType : "audio");
      return START_NOT_STICKY;
    }
    return START_NOT_STICKY;
  }

  private void startRinging(String callId, String callerName, String callType) {
    Context ctx = getApplicationContext();
    Intent launch = new Intent(ctx, MainActivity.class);
    launch.putExtra("callId", callId);
    launch.putExtra("autoAccept", false);
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

    int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      piFlags |= PendingIntent.FLAG_MUTABLE;
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      piFlags |= PendingIntent.FLAG_IMMUTABLE;
    }

    PendingIntent fullScreen = PendingIntent.getActivity(ctx, callId.hashCode(), launch, piFlags);

    int smallIcon = getApplicationInfo().icon;
    if (smallIcon == 0) {
      smallIcon = android.R.drawable.sym_call_incoming;
    }
    String body = "video".equalsIgnoreCase(callType) ? "Incoming video call" : "Incoming audio call";
    Notification notification =
      new NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(smallIcon)
        .setContentTitle(callerName)
        .setContentText(body)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setFullScreenIntent(fullScreen, true)
        .setContentIntent(fullScreen)
        .build();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }

    cancelVibration();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
      vibrator = vm != null ? vm.getDefaultVibrator() : null;
    } else {
      vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
    }
    if (vibrator != null && vibrator.hasVibrator()) {
      long[] pattern = new long[] {0, 500, 500};
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
      } else {
        vibrator.vibrate(pattern, 0);
      }
    }
  }

  private void cancelVibration() {
    try {
      if (vibrator != null) {
        vibrator.cancel();
      }
    } catch (Exception ignored) {
    }
    vibrator = null;
  }

  @Override
  public void onDestroy() {
    cancelVibration();
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
    } catch (Exception ignored) {
    }
    super.onDestroy();
  }
}
`;

const GYW_DEBUG_TRACE_JAVA = `package ${PKG};

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;

/** Append-only black-box trace for TECNO / background FCM diagnostics (survives crashes if flush succeeds). */
public final class GywDebugTrace {
    public static final String FILE_NAME = "gyw_debug_trace.txt";

    private GywDebugTrace() {}

    public static void append(Context ctx, String line) {
        if (ctx == null || line == null) return;
        FileWriter fw = null;
        try {
            fw = new FileWriter(new File(ctx.getApplicationContext().getFilesDir(), FILE_NAME), true);
            fw.write(System.currentTimeMillis() + " " + line + "\\n");
            fw.flush();
        } catch (Exception ignored) {
        } finally {
            if (fw != null) {
                try {
                    fw.close();
                } catch (Exception ignored2) {
                }
            }
        }
    }

    public static String readAll(Context ctx) {
        if (ctx == null) return "ERROR: null context";
        BufferedReader br = null;
        try {
            File f = new File(ctx.getApplicationContext().getFilesDir(), FILE_NAME);
            if (!f.exists()) {
                return "FILE_NOT_FOUND";
            }
            br = new BufferedReader(new FileReader(f));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) {
                sb.append(line).append('\\n');
            }
            return sb.toString();
        } catch (Exception e) {
            return "ERROR: " + e.getMessage();
        } finally {
            if (br != null) {
                try {
                    br.close();
                } catch (Exception ignored) {
                }
            }
        }
    }
}
`;

const GYW_FCM_SERVICE_JAVA = `package ${PKG};

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService;

public class GywFcmService extends ReactNativeFirebaseMessagingService {

    private static final String TAG = "GywFcm";
    private static final String PREFS_NAME = "GywCallPrefs";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.e(TAG, "✅ GywFcmService CREATED");
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> dataSnapshot = remoteMessage.getData();
        Log.e(TAG, "📩 onMessageReceived CALLED with data: "
                + (dataSnapshot != null ? dataSnapshot.toString() : "null"));

        GywDebugTrace.append(this, "STEP 1: FCM Received");
        try {
            handleFcmMessageBody(remoteMessage);
        } catch (Throwable t) {
            GywDebugTrace.append(this, "EXCEPTION body: " + t);
            Log.e(TAG, "❌ onMessageReceived EXCEPTION: "
                    + (t.getMessage() != null ? t.getMessage() : String.valueOf(t)), t);
        } finally {
            GywDebugTrace.append(this, "STEP 2: Calling Super");
            try {
                super.onMessageReceived(remoteMessage);
                GywDebugTrace.append(this, "STEP 3: Super Returned");
            } catch (Exception e) {
                GywDebugTrace.append(this, "EXCEPTION super: " + e);
                Log.e(TAG, "❌ onMessageReceived EXCEPTION (super): " + e.getMessage(), e);
            }
        }
    }

    private void handleFcmMessageBody(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = (data != null) ? data.get("type") : null;

        Log.e(TAG, "NATIVE_FCM_RECEIVED type=" + type);

        // Broadcast to JS so we can see it in Expo terminal
        GywCallModule.emitFcmReceived(
                data != null ? String.valueOf(data.get("callId")) : "null",
                type != null ? type : "null");

        // Also write to a file as absolute fallback proof
        try {
            java.io.File f = new java.io.File(
                    getApplicationContext().getFilesDir(), "gyw_fcm_log.txt");
            java.io.FileWriter fw = new java.io.FileWriter(f, true);
            fw.write(System.currentTimeMillis() + " FCM type=" + type
                    + " callId=" + (data != null ? data.get("callId") : "null") + "\\n");
            fw.close();
        } catch (Exception e) {
            Log.e(TAG, "❌ onMessageReceived fcm log write: " + e.getMessage());
        }

        if (type == null || type.isEmpty()) {
            Log.e(TAG, "NATIVE_FCM no type — ignoring");
            return;
        }

        if ("call_accepted".equals(type)
                || "call_rejected".equals(type)
                || "call_ended".equals(type)
                || "call_timeout".equals(type)) {
            Log.e(TAG, "NATIVE_FCM lifecycle type=" + type + " stopping GywCallService");
            try {
                Intent stopIntent = new Intent(this, GywCallService.class);
                stopIntent.setAction(GywCallService.ACTION_STOP);
                startService(stopIntent);
            } catch (Exception e) {
                Log.e(TAG, "NATIVE_FCM stop error: " + e.getMessage());
            }
            return;
        }

        if (!"incoming_call".equals(type) && !"call_invite".equals(type)) {
            Log.e(TAG, "NATIVE_FCM unknown type=" + type);
            return;
        }

        if (data == null) {
            Log.e(TAG, "NATIVE_FCM incoming_call but data null");
            return;
        }

        String callId = data.get("callId");
        String callerId = data.get("callerId");
        String callerName = data.get("callerName");
        String callType = data.get("callType");
        String hasVideo = data.get("hasVideo");

        if (callId == null || callId.isEmpty()) {
            Log.e(TAG, "NATIVE_FCM no callId — ignoring");
            return;
        }

        if (callType == null || callType.isEmpty()) {
            callType = "true".equals(hasVideo) ? "video" : "audio";
        }
        if (callerName == null || callerName.isEmpty()) {
            callerName = (callerId != null && !callerId.isEmpty()) ? callerId : "Unknown";
        }

        Log.e(TAG, "NATIVE_FCM_INCOMING callId=" + callId + " caller=" + callerName + " type=" + callType);

        try {
            SharedPreferences prefs =
                    getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString("pendingCallId", callId)
                    .putString("pendingCallerId", callerId != null ? callerId : "")
                    .putString("pendingCallerName", callerName)
                    .putString("pendingCallType", callType)
                    .putString("pendingCallAt", String.valueOf(System.currentTimeMillis()))
                    .apply();
            Log.e(TAG, "NATIVE_FCM prefs written callId=" + callId);
        } catch (Exception e) {
            Log.e(TAG, "NATIVE_FCM prefs error: " + e.getMessage());
        }

        try {
            GywDebugTrace.append(this, "STEP 4: Sending Start Intent (GywCallService)");
            Intent intent = new Intent(this, GywCallService.class);
            intent.setAction(GywCallService.ACTION_INCOMING);
            intent.putExtra(GywCallService.EXTRA_CALL_ID, callId);
            intent.putExtra(GywCallService.EXTRA_CALLER_NAME, callerName);
            intent.putExtra(GywCallService.EXTRA_CALL_TYPE, callType);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
            Log.e(TAG, "NATIVE_FCM_SERVICE_STARTED callId=" + callId);
        } catch (Exception e) {
            GywDebugTrace.append(this, "STEP 4 ERROR: " + e.getMessage());
            Log.e(TAG, "NATIVE_FCM start error: " + e.getMessage());
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        Log.e(TAG, "NATIVE_FCM token refreshed len=" + token.length());
        try {
            super.onNewToken(token);
        } catch (Exception e) {
            Log.e(TAG, "super.onNewToken: " + e.getMessage());
        }
    }
}
`;

const GYW_CALL_MODULE_JAVA = `package ${PKG};

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;

public class GywCallModule extends ReactContextBaseJavaModule {
  private static final String PREFS = "GywCallPrefs";

  private static ReactApplicationContext sReactContext = null;

  public GywCallModule(ReactApplicationContext reactContext) {
    super(reactContext);
    sReactContext = reactContext;
  }

  /** Called from GywFcmService to confirm native FCM fired. */
  public static void emitFcmReceived(String callId, String type) {
    if (sReactContext == null) return;
    try {
      sReactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
          .emit("GywNativeFcmReceived", callId + "|" + type);
    } catch (Exception e) { /* ignore — JS may not be ready */ }
  }

  @NonNull
  @Override
  public String getName() {
    return "GywCallModule";
  }

  @ReactMethod
  public void addListener(String eventName) { /* required for RN event emitter */ }

  @ReactMethod
  public void removeListeners(double count) { /* required for RN event emitter */ }

  @ReactMethod
  public void startIncomingCall(String callId, String callerName, String callType) {
    if (callId == null) return;
    ReactApplicationContext ctx = getReactApplicationContext();
    Intent intent = new Intent(ctx, GywCallService.class);
    intent.setAction(GywCallService.ACTION_INCOMING);
    intent.putExtra(GywCallService.EXTRA_CALL_ID, callId);
    intent.putExtra(GywCallService.EXTRA_CALLER_NAME, callerName != null ? callerName : "Unknown");
    intent.putExtra(GywCallService.EXTRA_CALL_TYPE, callType != null ? callType : "audio");
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ctx.startForegroundService(intent);
    } else {
      ctx.startService(intent);
    }
  }

  @ReactMethod
  public void stopIncomingCall() {
    ReactApplicationContext ctx = getReactApplicationContext();
    Intent intent = new Intent(ctx, GywCallService.class);
    intent.setAction(GywCallService.ACTION_STOP);
    ctx.startService(intent);
  }

  @ReactMethod
  public void getPendingCall(Promise promise) {
    try {
      SharedPreferences prefs =
          getReactApplicationContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
      String callId = prefs.getString("pendingCallId", null);
      if (callId == null || callId.isEmpty()) {
        promise.resolve(null);
        return;
      }
      WritableMap map = Arguments.createMap();
      map.putString("callId", callId);
      map.putString("callerId", prefs.getString("pendingCallerId", ""));
      map.putString("callerName", prefs.getString("pendingCallerName", "Unknown"));
      map.putString("callType", prefs.getString("pendingCallType", "audio"));
      map.putString("receivedAt", prefs.getString("pendingCallAt", "0"));
      promise.resolve(map);
    } catch (Exception e) {
      promise.resolve(null);
    }
  }

  @ReactMethod
  public void clearPendingCall() {
    try {
      getReactApplicationContext()
          .getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
          .edit()
          .clear()
          .apply();
    } catch (Exception e) {
      // ignore
    }
  }

  @ReactMethod
  public void readFcmLog(Promise promise) {
    try {
      File f = new File(getReactApplicationContext().getFilesDir(), "gyw_fcm_log.txt");
      if (!f.exists()) {
        promise.resolve("FILE_NOT_FOUND");
        return;
      }
      BufferedReader br = new BufferedReader(new FileReader(f));
      StringBuilder sb = new StringBuilder();
      String line;
      while ((line = br.readLine()) != null) sb.append(line).append("\\n");
      br.close();
      promise.resolve(sb.toString());
    } catch (Exception e) {
      promise.resolve("ERROR: " + e.getMessage());
    }
  }

  @ReactMethod
  public void appendDebugTrace(String line) {
    GywDebugTrace.append(getReactApplicationContext(), line != null ? line : "");
  }

  @ReactMethod
  public void readDebugTrace(Promise promise) {
    try {
      promise.resolve(GywDebugTrace.readAll(getReactApplicationContext()));
    } catch (Exception e) {
      promise.resolve("ERROR: " + e.getMessage());
    }
  }

  @ReactMethod
  public void getRegisteredFcmServices(Promise promise) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      PackageManager pm = ctx.getPackageManager();
      Intent intent = new Intent("com.google.firebase.MESSAGING_EVENT");
      intent.setPackage(ctx.getPackageName());
      @SuppressWarnings("deprecation")
      List<ResolveInfo> list = pm.queryIntentServices(intent, PackageManager.GET_META_DATA);
      StringBuilder sb = new StringBuilder();
      sb.append("MESSAGING_EVENT handlers for ").append(ctx.getPackageName()).append(":\\n");
      if (list == null || list.isEmpty()) {
        sb.append("(none)\\n");
      } else {
        for (ResolveInfo ri : list) {
          if (ri.serviceInfo != null) {
            sb.append(ri.serviceInfo.name).append("\\n");
          }
        }
      }
      promise.resolve(sb.toString());
    } catch (Exception e) {
      Log.e("GywCall", "getRegisteredFcmServices", e);
      promise.resolve("ERROR: " + e.getMessage());
    }
  }

  @ReactMethod
  public void getBatteryOptimizationStatus(Promise promise) {
    try {
      ReactApplicationContext ctx = getReactApplicationContext();
      JSONObject o = new JSONObject();
      PowerManager pwr = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
      boolean ignoring = false;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && pwr != null) {
        ignoring = pwr.isIgnoringBatteryOptimizations(ctx.getPackageName());
      }
      o.put("ignoringBatteryOptimizations", ignoring);

      int restrictBg = -1;
      String restrictLabel = "unknown";
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
          restrictBg = cm.getRestrictBackgroundStatus();
          switch (restrictBg) {
            case ConnectivityManager.RESTRICT_BACKGROUND_STATUS_DISABLED:
              restrictLabel = "RESTRICT_BACKGROUND_STATUS_DISABLED";
              break;
            case ConnectivityManager.RESTRICT_BACKGROUND_STATUS_WHITELISTED:
              restrictLabel = "RESTRICT_BACKGROUND_STATUS_WHITELISTED";
              break;
            case ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED:
              restrictLabel = "RESTRICT_BACKGROUND_STATUS_ENABLED";
              break;
            default:
              restrictLabel = "code_" + restrictBg;
              break;
          }
        }
      }
      o.put("restrictBackgroundStatusCode", restrictBg);
      o.put("restrictBackgroundStatus", restrictLabel);

      o.put("autoStartEnabled", JSONObject.NULL);
      o.put(
          "autoStartNote",
          "OEM auto-start / HiOS (TECNO) cannot be read via public APIs; check phone settings manually.");

      promise.resolve(o.toString());
    } catch (Exception e) {
      Log.e("GywCall", "getBatteryOptimizationStatus", e);
      promise.resolve("ERROR: " + e.getMessage());
    }
  }
}
`;

const GYW_CALL_PACKAGE_JAVA = `package ${PKG};

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class GywCallPackage implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext reactContext) {
    List<NativeModule> modules = new ArrayList<>();
    modules.add(new GywCallModule(reactContext));
    return modules;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }
}
`;
