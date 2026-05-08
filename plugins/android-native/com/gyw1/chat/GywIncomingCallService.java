package com.gyw1.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationCompat;

/**
 * Phone-call foreground service to reliably wake + show incoming call UI.
 *
 * <p>Uses the same notification id + tag as {@link GywIncomingCallNotifier} so a prior ring
 * cannot leave a second notification that blocks full-screen presentation.
 */
public class GywIncomingCallService extends Service {
  private static final String TAG = "GywIncomingCallService";

  public static final String ACTION_STOP = "com.gyw.incoming_call.STOP";

  public static final String EXTRA_CALL_ID = "callId";
  public static final String EXTRA_CALLER_NAME = "callerName";
  public static final String EXTRA_CALL_TYPE = "callType";
  public static final String EXTRA_FULL_SCREEN_MODE = "fullScreenMode";

  private static final String WAKELOCK_TAG = "gyw:call_service_wake";
  private static final long RING_WINDOW_MS = 30_000L;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private Runnable autoStopRunnable;
  private PowerManager.WakeLock wakeLock;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      Log.d(TAG, "STOP action received");
      Log.d(TAG, "CALL_CLEANUP start component=GywIncomingCallService action=STOP");
      cancelAutoStop();
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
          stopForeground(true);
        }
        Log.d(TAG, "foreground service stopped");
      } catch (Exception e) {
        Log.w(TAG, "foreground service stop failed: " + e.getMessage());
      }
      stopSelf();
      Log.d(TAG, "CALL_CLEANUP complete component=GywIncomingCallService action=STOP");
      return START_NOT_STICKY;
    }

    String callId = intent != null ? intent.getStringExtra(EXTRA_CALL_ID) : null;
    String callerName = intent != null ? intent.getStringExtra(EXTRA_CALLER_NAME) : null;
    String callType = intent != null ? intent.getStringExtra(EXTRA_CALL_TYPE) : "audio";
    boolean fullScreenMode = intent != null && intent.getBooleanExtra(EXTRA_FULL_SCREEN_MODE, false);
    Log.d(
        TAG,
        "onStartCommand callId="
            + callId
            + " callerName="
            + callerName
            + " callType="
            + callType
            + " fullScreenMode="
            + fullScreenMode
            + " startId="
            + startId);

    if (callId == null || callId.isEmpty()) {
      Log.w(TAG, "Started without callId — stopping");
      stopSelf();
      return START_NOT_STICKY;
    }

    cancelAutoStop();

    if (callerName == null || callerName.isEmpty()) callerName = "Incoming call";
    if (callType == null || callType.isEmpty()) callType = "audio";
    boolean video = "video".equalsIgnoreCase(callType);

    acquireWakeLock();

    // Start ring/vibrate BEFORE startForeground so the phone always rings
    // even if startForeground throws (e.g. ForegroundServiceTypeNotAllowedException
    // on some devices).  GywIncomingCallAlerts.start() is idempotent.
    GywIncomingCallAlerts.start(this, callId);
    Log.d(TAG, "ring/vibrate started");

    NotificationManager nm =
        (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    GywIncomingCallNotifier.ensureIncomingCallChannel(this, nm);
    NotificationChannel callChannel =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null
            ? nm.getNotificationChannel(GywIncomingCallNotifier.CHANNEL_ID)
            : null;
    Log.d(
        TAG,
        "service channelId=" + GywIncomingCallNotifier.CHANNEL_ID
            + " importance=" + (callChannel != null ? callChannel.getImportance() : -1));

    Notification notification = buildNotification(callId, callerName, callType, video, fullScreenMode);
    int notifId = GywIncomingCallNotifier.ACTIVE_INCOMING_CALL_NOTIFICATION_ID;

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(notifId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
      } else {
        startForeground(notifId, notification);
      }
      Log.d(TAG, "startForeground ok");
    } catch (Exception e) {
      Log.e(TAG, "startForeground failed: " + e.getMessage());
      // Alerts already ringing — keep them going for the ring window,
      // but the FGS couldn't post its notification (no full-screen intent).
      // Schedule an auto-stop so we release the WakeLock eventually.
      final String stopCallId = callId;
      autoStopRunnable = () -> {
        synchronized (GywIncomingCallAlerts.class) {
          GywIncomingCallAlerts.stop(getApplicationContext());
        }
        stopSelf();
      };
      mainHandler.postDelayed(autoStopRunnable, RING_WINDOW_MS);
      return START_NOT_STICKY;
    }

    if (fullScreenMode) {
      try {
        Intent launch =
            IncomingCallActivity.buildShowIntent(
                this, callId, callerName, null, callType);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Bundle launchOpts = GywIncomingCallNotifier.backgroundDirectStartBundle();
        if (launchOpts != null) {
          startActivity(launch, launchOpts);
        } else {
          startActivity(launch);
        }
        Log.d(TAG, "CALL_UI_MODE = FULLSCREEN_LOCKED");
        Log.d(TAG, "IncomingCallActivity launched from foreground service");
      } catch (Throwable t) {
        Log.e(TAG, "Failed to launch IncomingCallActivity from service", t);
      }
    } else {
      Log.d(TAG, "CALL_UI_MODE = HEADSUP_UNLOCKED");
      Log.d(TAG, "Heads-up only mode; skip IncomingCallActivity launch");
    }

    autoStopRunnable = this::stopSelf;
    mainHandler.postDelayed(autoStopRunnable, RING_WINDOW_MS);

    return START_NOT_STICKY;
  }

  private void cancelAutoStop() {
    if (autoStopRunnable != null) {
      mainHandler.removeCallbacks(autoStopRunnable);
      autoStopRunnable = null;
    }
  }

  @Override
  public void onDestroy() {
    Log.d(TAG, "CALL_CLEANUP start component=GywIncomingCallService action=onDestroy");
    cancelAutoStop();
    GywIncomingCallAlerts.stop(this);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(Service.STOP_FOREGROUND_REMOVE);
      } else {
        stopForeground(true);
      }
    } catch (Exception ignored) {
    }
    Log.d(TAG, "foreground service stopped");
    super.onDestroy();
    releaseWakeLock();
    Log.d(TAG, "CALL_CLEANUP complete component=GywIncomingCallService action=onDestroy");
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @SuppressWarnings("deprecation")
  private void acquireWakeLock() {
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm == null) return;
      wakeLock =
          pm.newWakeLock(
              PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                  | PowerManager.ACQUIRE_CAUSES_WAKEUP
                  | PowerManager.ON_AFTER_RELEASE,
              WAKELOCK_TAG);
      wakeLock.acquire(RING_WINDOW_MS);
    } catch (Exception e) {
      Log.w(TAG, "WakeLock acquire failed: " + e.getMessage());
    }
  }

  private void releaseWakeLock() {
    if (wakeLock != null && wakeLock.isHeld()) {
      try {
        wakeLock.release();
      } catch (Exception ignored) {
      }
      wakeLock = null;
    }
  }

  private Notification buildNotification(
      String callId, String callerName, String callTypeRaw, boolean video, boolean fullScreenMode) {
    String title = video ? "Incoming video call" : "Incoming call";
    int reqBase = GywIncomingCallNotifier.requestCodesBase(callId);
    int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    Intent contentIntent =
        IncomingCallActivity.buildShowIntent(this, callId, callerName, null, callTypeRaw);
    PendingIntent contentPi = GywIncomingCallNotifier.activityPendingIntent(this, reqBase, contentIntent);

    Intent fullScreenIntent =
        IncomingCallActivity.buildShowIntent(this, callId, callerName, null, callTypeRaw);
    PendingIntent fullScreenPi =
        GywIncomingCallNotifier.activityPendingIntent(this, reqBase + 1, fullScreenIntent);

    Intent acceptBroadcast = new Intent(this, GywCallNotificationActionReceiver.class);
    acceptBroadcast.setAction(GywCallNotificationActionReceiver.ACTION_ACCEPT);
    acceptBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_ID, callId);
    acceptBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_TYPE, callTypeRaw);
    PendingIntent acceptPi =
        PendingIntent.getBroadcast(this, reqBase + 2, acceptBroadcast, piFlags);

    Intent declineBroadcast = new Intent(this, GywCallNotificationActionReceiver.class);
    declineBroadcast.setAction(GywCallNotificationActionReceiver.ACTION_DECLINE);
    declineBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_ID, callId);
    declineBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_TYPE, callTypeRaw);
    PendingIntent declinePi =
        PendingIntent.getBroadcast(this, reqBase + 3, declineBroadcast, piFlags);

    NotificationCompat.Builder b =
        new NotificationCompat.Builder(this, GywIncomingCallNotifier.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(title)
            .setContentText(callerName)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setContentIntent(contentPi)
            .addAction(android.R.drawable.sym_action_call, "Accept", acceptPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi);
    if (fullScreenMode) {
      b.setFullScreenIntent(fullScreenPi, true);
    }

    boolean postNotificationsGranted =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(
                    this, android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    boolean canUseFullScreenIntent =
        Build.VERSION.SDK_INT < 34
            || ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE))
                .canUseFullScreenIntent();
    Log.d(
        TAG,
        "buildNotification callId=" + callId
            + " category=" + NotificationCompat.CATEGORY_CALL
            + " priority=" + NotificationCompat.PRIORITY_HIGH
            + " fullScreenIntentAttached=" + fullScreenMode
            + " postNotificationsGranted=" + postNotificationsGranted
            + " canUseFullScreenIntent=" + canUseFullScreenIntent);

    if (Build.VERSION.SDK_INT >= 34) {
      b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
    }

    b.setColorized(true);

    return b.build();
  }

}
