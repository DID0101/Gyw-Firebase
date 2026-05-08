package com.gyw1.chat;

import android.app.ActivityOptions;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.PackageManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationCompat;

/**
 * Incoming-call notifications only.
 *
 * <p><b>Stale notifications</b>: each new ring uses a <b>fixed</b> notification id + tag so we
 * replace the previous incoming surface. Before ringing we cancel any active notification on
 * legacy call channels so an old heads-up card cannot block full-screen call UI.
 */
public final class GywIncomingCallNotifier {
  private static final String TAG = "GywIncomingCallNotifier";
  private static final String PREFS = "gyw_incoming_call_prefs";
  private static final String PREF_ACTIVE_CALL_ID = "active_call_id";

  /**
   * Must match {@code CALL_ANDROID_CHANNEL_ID} in lib/notifications/constants.ts.
   * Dedicated high-importance call channel (full-screen intent eligible).
   *
   * <p>v2: channel has no sound/vibration — GywIncomingCallAlerts owns all audio/haptics
   * to prevent the channel alert from double-ringing on top of it.
   */
  public static final String CHANNEL_ID = "call_channel_v2";

  /** Legacy channel ids — cleared on each incoming so stale surfaces cannot linger. */
  private static final String LEGACY_CHANNEL_ID_V0 = "incoming_calls_v2";

  private static final String LEGACY_CHANNEL_ID_V1 = "incoming_calls";

  private static final String LEGACY_CHANNEL_ID_V5 = "gyw_calls_v5";

  private static final String LEGACY_CHANNEL_ID_V6 = "gyw_calls_v6";

  /** Previous call channel that had sound — superseded by CHANNEL_ID (call_channel_v2). */
  private static final String LEGACY_CHANNEL_ID_V7 = "call_channel";

  /**
   * Single slot for “the current incoming call” notification (heads-up or FGS). Replaces any
   * prior per-callId hash ids that stacked and confused OEM full-screen / vibration.
   */
  public static final String NOTIFICATION_TAG = "gyw_incoming_call";

  public static final int ACTIVE_INCOMING_CALL_NOTIFICATION_ID = 0x27594757;

  /** WakeLock tag shown in battery stats. */
  private static final String WAKELOCK_TAG = "gyw:incoming_call_wake";

  /** API 27+ activity flags (numeric to avoid lint on older API levels). */
  private static final int FLAG_SHOW_WHEN_LOCKED = 0x00080000;
  private static final int FLAG_TURN_SCREEN_ON = 0x00200000;

  private GywIncomingCallNotifier() {}

  /**
   * ActivityOptions bundle for {@link android.app.PendingIntent#getActivity} calls.
   *
   * <p>Android 14+ (API 34): PendingIntents fired from notifications (including full-screen
   * intents) need {@code setPendingIntentBackgroundActivityStartMode(ALLOWED)} so the activity
   * is permitted to launch from the background notification context.
   */
  @Nullable
  public static Bundle backgroundActivityLaunchBundle() {
    if (Build.VERSION.SDK_INT < 34) {
      return null;
    }
    ActivityOptions opts = ActivityOptions.makeBasic();
    opts.setPendingIntentBackgroundActivityStartMode(
        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
    return opts.toBundle();
  }

  /**
   * ActivityOptions bundle for direct {@link android.content.Context#startActivity} calls
   * made from a background context (e.g. a foreground service).
   *
   * <p>Android 14+ (API 34): Direct {@code startActivity()} from a background component
   * needs {@code setBackgroundActivityStartMode(ALLOWED)} even when the caller is a
   * {@code FOREGROUND_SERVICE_TYPE_PHONE_CALL} service.  On API 29-33 the FGS-phoneCall
   * exemption applies automatically and no extra options are required.
   */
  @Nullable
  public static Bundle backgroundDirectStartBundle() {
    if (Build.VERSION.SDK_INT < 34) {
      return null;
    }
    try {
      ActivityOptions opts = ActivityOptions.makeBasic();
      // compileSdk 35 stubs expose this; reflection keeps older AGP stubs compiling.
      java.lang.reflect.Method m =
          ActivityOptions.class.getMethod(
              "setBackgroundActivityStartMode", int.class);
      m.invoke(opts, ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
      return opts.toBundle();
    } catch (Throwable t) {
      Log.w(TAG, "backgroundDirectStartBundle: " + t.getMessage());
      return null;
    }
  }

  public static PendingIntent activityPendingIntent(
      Context context, int requestCode, Intent intent) {
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    Bundle opts = backgroundActivityLaunchBundle();
    Log.d(
        TAG,
        "activityPendingIntent requestCode=" + requestCode
            + " hasBackgroundOpts=" + (opts != null)
            + " target=" + intent.getComponent());
    if (opts != null) {
      return PendingIntent.getActivity(context, requestCode, intent, flags, opts);
    }
    return PendingIntent.getActivity(context, requestCode, intent, flags);
  }

  /** Distinct PendingIntent request codes per callId (notification id stays fixed). */
  public static int requestCodesBase(String callId) {
    return Math.abs(("incoming_pi_" + callId).hashCode());
  }

  /** Legacy hash id — only used to cancel notifications created before the fixed id. */
  @Deprecated
  public static int notifId(String callId) {
    return ("incoming_call_" + callId).hashCode();
  }

  /**
   * Stops ring/vibrate, cancels the active incoming slot, and removes any lingering notification on
   * call channels (including legacy). Call immediately before posting a new incoming call.
   */
  public static void clearIncomingCallUiBeforeRinging(Context context) {
    Context app = context.getApplicationContext();
    sendFinishIncomingActivityBroadcast(app);
    GywIncomingCallAlerts.stop(app);
    NotificationManager nm =
        (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;

    try {
      nm.cancel(NOTIFICATION_TAG, ACTIVE_INCOMING_CALL_NOTIFICATION_ID);
      nm.cancel(null, ACTIVE_INCOMING_CALL_NOTIFICATION_ID);
    } catch (Exception e) {
      Log.w(TAG, "cancel active slot: " + e.getMessage());
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try {
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
          android.app.Notification n = sbn.getNotification();
          if (n == null) continue;
          String ch = n.getChannelId();
          if (CHANNEL_ID.equals(ch)
              || LEGACY_CHANNEL_ID_V0.equals(ch)
              || LEGACY_CHANNEL_ID_V1.equals(ch)
              || LEGACY_CHANNEL_ID_V5.equals(ch)
              || LEGACY_CHANNEL_ID_V6.equals(ch)
              || LEGACY_CHANNEL_ID_V7.equals(ch)) {
            nm.cancel(sbn.getTag(), sbn.getId());
          }
        }
      } catch (Exception e) {
        Log.w(TAG, "clear channel notifications: " + e.getMessage());
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      for (String legacyId : new String[]{LEGACY_CHANNEL_ID_V5, LEGACY_CHANNEL_ID_V7}) {
        try {
          nm.deleteNotificationChannel(legacyId);
        } catch (Exception ignored) {
        }
      }
    }
    rememberActiveCallId(app, null);
  }

  /** Cancels the incoming-call notification. Call this when the user opens the call screen. */
  public static void cancel(Context context, String callId) {
    GywIncomingCallAlerts.stop(context);
    NotificationManager nm =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    try {
      nm.cancel(NOTIFICATION_TAG, ACTIVE_INCOMING_CALL_NOTIFICATION_ID);
      nm.cancel(null, ACTIVE_INCOMING_CALL_NOTIFICATION_ID);
      if (callId != null && !callId.isEmpty()) {
        nm.cancel(notifId(callId));
      }
    } catch (Exception e) {
      Log.w(TAG, "cancel: " + e.getMessage());
    }
    rememberActiveCallId(context.getApplicationContext(), null);
  }

  /**
   * Stops ringtone/vibration, cancels the incoming notification, stops {@link GywIncomingCallService},
   * and closes {@link IncomingCallActivity} if it is open.
   */
  public static void stopRingingAndDismissUi(Context context, String callId) {
    Context app = context.getApplicationContext();
    Log.d(TAG, "CALL_CLEANUP start component=GywIncomingCallNotifier callId=" + callId);
    CallConnectionService.Companion.reportCallEnded(app, callId == null ? "" : callId);
    IncomingCallGuard.release(app, callId, "native_stop_dismiss");
    GywIncomingCallAlerts.stop(app);
    cancel(app, callId);
    sendFinishIncomingActivityBroadcast(app);
    Intent stop = new Intent(app, GywIncomingCallService.class);
    stop.setAction(GywIncomingCallService.ACTION_STOP);
    try {
      app.startService(stop);
      Log.d(TAG, "foreground service stop requested");
    } catch (Exception e) {
      Log.w(TAG, "stop service: " + e.getMessage());
    }
    Log.d(TAG, "notification removed");
    Log.d(TAG, "CALL_CLEANUP complete component=GywIncomingCallNotifier callId=" + callId);
  }

  public static void launchMainActivityCallDeepLink(
      Context context, String callId, boolean accept, @Nullable String callType) {
    Context app = context.getApplicationContext();
    String pkg = app.getPackageName();
    String normalizedType = "video".equalsIgnoreCase(callType) ? "video" : "audio";
    String uriStr =
        "gyw://call/"
            + callId
            + (accept ? "?accept=1&callType=" : "?decline=1&callType=")
            + normalizedType;
    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
    intent.setClassName(pkg, pkg + ".MainActivity");
    intent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      intent.addFlags(FLAG_SHOW_WHEN_LOCKED | FLAG_TURN_SCREEN_ON);
    }
    try {
      // Direct startActivity() requires backgroundDirectStartBundle(), not
      // backgroundActivityLaunchBundle() which is for PendingIntent contexts.
      Bundle opts = backgroundDirectStartBundle();
      if (opts != null) {
        app.startActivity(intent, opts);
      } else {
        app.startActivity(intent);
      }
    } catch (Exception e) {
      Log.w(TAG, "launchMainActivityCallDeepLink: " + e.getMessage());
    }
  }

  private static void sendFinishIncomingActivityBroadcast(Context app) {
    try {
      Intent i = new Intent(IncomingCallActivity.ACTION_FINISH_INCOMING_UI);
      i.setPackage(app.getPackageName());
      app.sendBroadcast(i);
    } catch (Exception e) {
      Log.w(TAG, "finish incoming UI broadcast: " + e.getMessage());
    }
  }

  /**
   * @param fullScreenIncomingUi true when the device screen is off / non-interactive — use
   *     full-screen intent + wake lock. false when the user is likely in another app with the
   *     screen on — heads-up call "popup" only.
   */
  public static void show(Context context, Bundle data, boolean fullScreenIncomingUi) {
    if (data == null) return;

    String callId = data.getString("callId");
    if (callId == null || callId.isEmpty()) {
      Log.w(TAG, "incoming_call push missing callId — ignoring");
      return;
    }

    if (!IncomingCallGuard.isLocked(context, callId)) {
      if (!IncomingCallGuard.tryAcquire(context, callId, "notifier_show")) {
        return;
      }
    } else {
      Log.d(
          TAG,
          "INCOMING_TRIGGER source=notifier_show callId="
              + callId
              + " ts="
              + System.currentTimeMillis()
              + " allowed=true duplicate=false");
    }

    String activeCallId = activeCallId(context.getApplicationContext());
    if (activeCallId != null && !activeCallId.isEmpty() && !activeCallId.equals(callId)) {
      Log.w(TAG, "incoming_call ignored (already ringing " + activeCallId + "), rejecting " + callId);
      launchMainActivityCallDeepLink(context, callId, false, null);
      return;
    }

    clearIncomingCallUiBeforeRinging(context);

    String callerName = data.getString("callerName");
    if (callerName == null || callerName.isEmpty()) callerName = "Incoming call";

    String callTypeRaw = data.getString("callType");
    if (callTypeRaw == null || callTypeRaw.isEmpty()) callTypeRaw = "audio";

    boolean video = "video".equalsIgnoreCase(callTypeRaw);
    String title = video ? "Incoming video call" : "Incoming call";

    if (fullScreenIncomingUi) {
      acquireWakeLock(context);
    }

    NotificationManager nm =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;

    ensureIncomingCallChannel(context, nm);
    NotificationChannel channel =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? nm.getNotificationChannel(CHANNEL_ID) : null;
    Log.d(
        TAG,
        "show() callId=" + callId
            + " fullScreenIncomingUi=" + fullScreenIncomingUi
            + " channelId=" + CHANNEL_ID
            + " channelImportance=" + (channel != null ? channel.getImportance() : -1));

    boolean postNotificationsGranted =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(
                    context, android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    Log.d(TAG, "POST_NOTIFICATIONS granted=" + postNotificationsGranted);

    if (Build.VERSION.SDK_INT >= 34 && fullScreenIncomingUi) {
      Log.d(TAG, "USE_FULL_SCREEN_INTENT granted=" + nm.canUseFullScreenIntent());
    }

    int reqBase = requestCodesBase(callId);
    int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    Intent contentIntent =
        IncomingCallActivity.buildShowIntent(
            context, callId, callerName, data.getString("callerAvatar"), callTypeRaw);
    PendingIntent contentPi = activityPendingIntent(context, reqBase, contentIntent);

    Intent fullScreenIntent =
        IncomingCallActivity.buildShowIntent(
            context, callId, callerName, data.getString("callerAvatar"), callTypeRaw);
    PendingIntent fullScreenPi = activityPendingIntent(context, reqBase + 1, fullScreenIntent);

    Intent acceptBroadcast = new Intent(context, GywCallNotificationActionReceiver.class);
    acceptBroadcast.setAction(GywCallNotificationActionReceiver.ACTION_ACCEPT);
    acceptBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_ID, callId);
    acceptBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_TYPE, callTypeRaw);
    PendingIntent acceptPi =
        PendingIntent.getBroadcast(context, reqBase + 2, acceptBroadcast, piFlags);

    Intent declineBroadcast = new Intent(context, GywCallNotificationActionReceiver.class);
    declineBroadcast.setAction(GywCallNotificationActionReceiver.ACTION_DECLINE);
    declineBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_ID, callId);
    declineBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_TYPE, callTypeRaw);
    PendingIntent declinePi =
        PendingIntent.getBroadcast(context, reqBase + 3, declineBroadcast, piFlags);

    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, CHANNEL_ID)
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
            .addAction(
                android.R.drawable.sym_action_call,
                "Accept",
                acceptPi)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Decline",
                declinePi);

    if (Build.VERSION.SDK_INT >= 34) {
      b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
    }

    if (fullScreenIncomingUi) {
      // Avoid CallStyle runtime rejection on some OEM/API combinations.
      b.setColorized(true);
    }

    if (fullScreenIncomingUi) {
      b.setFullScreenIntent(fullScreenPi, true);
    }
    Log.d(
        TAG,
        "CALL_UI_MODE = " + (fullScreenIncomingUi ? "FULLSCREEN_LOCKED" : "HEADSUP_UNLOCKED"));
    Log.d(
        TAG,
        "notify incoming_call category=" + NotificationCompat.CATEGORY_CALL
            + " priority=" + NotificationCompat.PRIORITY_HIGH
            + " fullScreenIntentAttached=" + fullScreenIncomingUi + " contentPi=" + contentPi
            + " fullScreenPi=" + fullScreenPi);

    try {
      nm.notify(NOTIFICATION_TAG, ACTIVE_INCOMING_CALL_NOTIFICATION_ID, b.build());
      GywIncomingCallAlerts.start(context, callId);
      rememberActiveCallId(context.getApplicationContext(), callId);
    } catch (SecurityException e) {
      Log.e(TAG, "nm.notify() denied — POST_NOTIFICATIONS not granted?", e);
      GywIncomingCallAlerts.start(context, callId);
      rememberActiveCallId(context.getApplicationContext(), callId);
    } catch (Throwable t) {
      Log.e(TAG, "nm.notify() failed", t);
    }
  }

  @SuppressWarnings("deprecation")
  private static void acquireWakeLock(Context context) {
    try {
      PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
      if (pm == null) return;

      PowerManager.WakeLock wl =
          pm.newWakeLock(
              PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                  | PowerManager.ACQUIRE_CAUSES_WAKEUP
                  | PowerManager.ON_AFTER_RELEASE,
              WAKELOCK_TAG);
      wl.acquire(30_000L);
      Log.d(TAG, "WakeLock acquired (30 s)");
    } catch (Exception e) {
      Log.w(TAG, "WakeLock acquire failed: " + e.getMessage());
    }
  }

  /**
   * Creates the high-importance incoming-call channel (ring + vibration). Safe to call from
   * {@link GywIncomingCallService} — no-op if the channel already exists.
   */
  public static void ensureIncomingCallChannel(Context context, NotificationManager nm) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    if (nm == null) return;
    if (nm.getNotificationChannel(CHANNEL_ID) != null) {
      NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
      Log.d(
          TAG,
          "Channel already exists: " + CHANNEL_ID
              + " importance=" + (existing != null ? existing.getImportance() : -1)
              + " sound=" + (existing != null ? existing.getSound() : null)
              + " vibration=" + (existing != null && existing.shouldVibrate()));
      return;
    }
    Log.d(TAG, "Creating channel: " + CHANNEL_ID);

    Uri ringUri = GywIncomingCallAlerts.defaultRingtoneUri(context);
    AudioAttributes audioAttrs =
        new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

    NotificationChannel ch =
        new NotificationChannel(
            CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_MAX);
    ch.setDescription("Incoming voice and video calls");
    ch.enableVibration(true);
    ch.setVibrationPattern(new long[] {0, 400, 200, 400});
    ch.setSound(ringUri, audioAttrs);
    ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    ch.setBypassDnd(true);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ch.setAllowBubbles(false);
    }
    nm.createNotificationChannel(ch);
    Log.d(
        TAG,
        "Notification channel created: " + CHANNEL_ID
            + " importance=" + ch.getImportance()
            + " sound=" + ch.getSound()
            + " vibration=" + ch.shouldVibrate());
  }

  private static String activeCallId(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_ACTIVE_CALL_ID, null);
  }

  private static void rememberActiveCallId(Context context, String callId) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_ACTIVE_CALL_ID, callId)
        .apply();
  }

  /**
   * True while an incoming-call notification / ringing surface is active (same prefs as
   * {@link #rememberActiveCallId}). Used to lower chat message interruption — does not read
   * call channel state.
   */
  public static boolean hasActiveIncomingCallUi(Context context) {
    String id = activeCallId(context.getApplicationContext());
    return id != null && !id.isEmpty();
  }
}
