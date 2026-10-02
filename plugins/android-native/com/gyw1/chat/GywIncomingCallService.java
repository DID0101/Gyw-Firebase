package com.gyw1.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

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
  public static final String EXTRA_CALLER_AVATAR = "callerAvatar";
  public static final String EXTRA_FULL_SCREEN_MODE = "fullScreenMode";
  /** When true, Telecom {@code onShowIncomingCallUi} owns activity launch — FGS must not duplicate. */
  public static final String EXTRA_TELECOM_DISPATCHED = "telecomDispatched";

  private static final String WAKELOCK_TAG = "gyw:call_service_wake";
  private static final long RING_WINDOW_MS = 30_000L;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private Runnable autoStopRunnable;
  private PowerManager.WakeLock wakeLock;
  @Nullable private String activeCallId;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      Log.d(TAG, "STOP action received");
      Log.d(TAG, "CALL_CLEANUP start component=GywIncomingCallService action=STOP");
      IncomingCallUiLauncher.cancelScheduled(mainHandler, activeCallId);
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
    String callerAvatar = intent != null ? intent.getStringExtra(EXTRA_CALLER_AVATAR) : null;
    boolean fullScreenMode =
        intent != null && intent.getBooleanExtra(EXTRA_FULL_SCREEN_MODE, false);
    if (!fullScreenMode) {
      fullScreenMode = IncomingCallProcessState.isRestrictiveEnvironment(this);
    }
    boolean restrictiveEnv = IncomingCallProcessState.isRestrictiveEnvironment(this);
    IncomingCallProcessState.logIncomingUxContext(this, TAG);
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
    activeCallId = callId;
    IncomingCallUiLauncher.cancelScheduled(mainHandler, callId);

    if (callerName == null || callerName.isEmpty()) callerName = "Incoming call";
    callType = GywIncomingCallNotifier.normalizeCallType(callType);
    Log.d(
        TAG,
        "CALL_TYPE="
            + callType
            + " isVideo="
            + GywIncomingCallNotifier.isVideoCallType(callType)
            + " FULLSCREEN_PATH_SELECTED="
            + fullScreenMode);

    if (fullScreenMode) {
      acquireWakeLock();
      Log.d(TAG, "SCREEN_WAKE_TRIGGERED source=foreground_service callId=" + callId);
      Log.d(TAG, "SCREEN_WAKE_SUCCESS source=foreground_service callId=" + callId);
    }

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

    Log.d(TAG, "FGS_NOTIFICATION_MODE=premium_backup callId=" + callId);
    Notification notification =
        GywIncomingCallNotifier.buildIncomingCallNotification(
            this, callId, callerName, callerAvatar, callType, true, false);
    int notifId = GywIncomingCallNotifier.ACTIVE_INCOMING_CALL_NOTIFICATION_ID;

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(notifId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
      } else {
        startForeground(notifId, notification);
      }
      Log.d(TAG, "FOREGROUND_STARTED callId=" + callId);
      Log.d(TAG, "FOREGROUND_STABLE callId=" + callId);
      Log.d(TAG, "startForeground ok");
      Log.d(
          TAG,
          "CALL_NOTIFICATION_SHOWN source=foreground_service backup=true callId="
              + callId
              + " CALL_NOTIFICATION_ID="
              + notifId
              + " tag="
              + GywIncomingCallNotifier.NOTIFICATION_TAG);
    } catch (Exception e) {
      Log.e(TAG, "startForeground failed: " + e.getMessage());
      Bundle fallback = new Bundle();
      fallback.putString(EXTRA_CALL_ID, callId);
      fallback.putString(EXTRA_CALLER_NAME, callerName);
      fallback.putString(EXTRA_CALLER_AVATAR, callerAvatar);
      fallback.putString(EXTRA_CALL_TYPE, callType);
      GywIncomingCallNotifier.show(this, fallback, fullScreenMode);
      autoStopRunnable =
          () -> {
            synchronized (GywIncomingCallAlerts.class) {
              GywIncomingCallAlerts.stop(getApplicationContext());
            }
            stopSelf();
          };
      mainHandler.postDelayed(autoStopRunnable, RING_WINDOW_MS);
      return START_NOT_STICKY;
    }

    GywIncomingCallAlerts.start(this, callId, callType);
    Log.d(TAG, "ring/vibrate started");

    boolean telecomDispatched =
        intent != null && intent.getBooleanExtra(EXTRA_TELECOM_DISPATCHED, false);

    Log.d(
        TAG,
        "FGS_ACTIVITY_LAUNCH_POLICY=telecom_onShowIncomingCallUi_only retries=false "
            + "restrictive="
            + restrictiveEnv
            + " telecomDispatched="
            + telecomDispatched);

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
    IncomingCallUiLauncher.cancelScheduled(mainHandler, activeCallId);
    activeCallId = null;
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
}
