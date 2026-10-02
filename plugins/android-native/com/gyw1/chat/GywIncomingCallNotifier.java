package com.gyw1.chat;

import android.app.ActivityManager;
import android.app.ActivityOptions;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.PackageManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.hardware.display.DisplayManager;
import android.view.Display;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.Person;
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
   * <p>v3: channel has no sound/vibration — GywIncomingCallAlerts owns all audio/haptics
   * to prevent the channel alert from double-ringing on top of it.
   */
  /** Align with {@link IncomingCallFcmHandler#CALL_CHANNEL_ID}. */
  public static final String CHANNEL_ID = "incoming_calls_v3";

  /** Silent channel for phone-call FGS — avoids heads-up competing with IncomingCallActivity. */
  public static final String SERVICE_CHANNEL_ID = "incoming_call_service_silent";

  /** v2 had channel sound — deleted on upgrade so OEM cannot double-ring. */
  private static final String LEGACY_CHANNEL_ID_V2 = "call_channel_v2";

  /** Legacy channel ids — cleared on each incoming so stale surfaces cannot linger. */
  private static final String LEGACY_CHANNEL_ID_V0 = "incoming_calls_v2";

  private static final String LEGACY_CHANNEL_ID_V1 = "incoming_calls";

  private static final String LEGACY_CHANNEL_ID_V5 = "gyw_calls_v5";

  private static final String LEGACY_CHANNEL_ID_V6 = "gyw_calls_v6";

  /** Previous call channel that had sound — superseded by CHANNEL_ID. */
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

  /** Normalizes FCM / intent call type to {@code audio} or {@code video}. */
  public static String normalizeCallType(@Nullable String raw) {
    if (raw == null) return "audio";
    String t = raw.trim().toLowerCase();
    if ("video".equals(t)) return "video";
    return "audio";
  }

  public static boolean isVideoCallType(@Nullable String callTypeRaw) {
    return "video".equals(normalizeCallType(callTypeRaw));
  }

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
    return activityPendingIntent(context, requestCode, intent, false);
  }

  public static PendingIntent activityPendingIntent(
      Context context, int requestCode, Intent intent, boolean forFullScreen) {
    int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    Bundle opts = backgroundActivityLaunchBundle();
    if (forFullScreen) {
      Log.d(
          TAG,
          "FULLSCREEN_PENDING_INTENT_CREATED requestCode="
              + requestCode
              + " target="
              + intent.getComponent());
    }
    Log.d(
        TAG,
        "activityPendingIntent requestCode=" + requestCode
            + " hasBackgroundOpts=" + (opts != null)
            + " forFullScreen=" + forFullScreen
            + " target=" + intent.getComponent());
    if (opts != null) {
      return PendingIntent.getActivity(context, requestCode, intent, flags, opts);
    }
    return PendingIntent.getActivity(context, requestCode, intent, flags);
  }

  /** True when the app process is foreground or visible (user is likely in the app). */
  public static boolean isAppInForeground(Context context) {
    int importance = processImportance(context.getApplicationContext());
    boolean foreground =
        importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    Log.d(TAG, "isAppInForeground importance=" + importance + " -> " + foreground);
    return foreground;
  }

  /**
   * True when the incoming call should use full-screen UI (killed, background, lock screen, or
   * display off). Open-app with screen on stays heads-up only.
   */
  /** @deprecated Prefer {@link IncomingCallProcessState#isRestrictiveEnvironment}. */
  public static boolean wantsFullScreenIncomingUi(Context context) {
    return IncomingCallProcessState.isRestrictiveEnvironment(context);
  }

  /**
   * Posts the premium incoming-call notification (heads-up on lockscreen / killed state).
   * Idempotent with {@link #ACTIVE_INCOMING_CALL_NOTIFICATION_ID}.
   */
  public static void postPremiumIncomingCallNotification(
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callTypeRaw) {
    Context app = context.getApplicationContext();
    NotificationManager nm =
        (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    ensureIncomingCallChannel(app, nm);
    if (IncomingCallProcessState.isRestrictiveEnvironment(app)) {
      acquireWakeLock(app);
    }
    Notification notification =
        buildIncomingCallNotification(
            app, callId, callerName, callerAvatar, callTypeRaw, true, false);
    try {
      nm.notify(NOTIFICATION_TAG, ACTIVE_INCOMING_CALL_NOTIFICATION_ID, notification);
      rememberActiveCallId(app, callId);
      Log.w(TAG, "PREMIUM_CALL_NOTIFICATION_POSTED callId=" + callId);
    } catch (Exception e) {
      Log.e(TAG, "PREMIUM_CALL_NOTIFICATION_FAILED callId=" + callId, e);
    }
  }

  public static boolean canUseFullScreenIntent(Context context) {
    if (Build.VERSION.SDK_INT < 34) return true;
    NotificationManager nm =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    boolean allowed = nm == null || nm.canUseFullScreenIntent();
    Log.d(TAG, "canUseFullScreenIntent=" + allowed);
    return allowed;
  }

  /** Delegates to {@link IncomingCallUiLauncher} (single authoritative activity path). */
  public static void launchFullScreenIncomingActivity(
      Context context,
      String callId,
      String callerName,
      String callerAvatar,
      String callType,
      String source) {
    IncomingCallUiLauncher.launchDirect(
        context, callId, callerName, callerAvatar, callType, source);
  }

  /** Delegates to {@link IncomingCallUiLauncher#scheduleAfterForeground}. */
  public static void scheduleFullScreenActivityRetries(
      android.os.Handler handler,
      Context context,
      String callId,
      String callerName,
      String callerAvatar,
      String callType) {
    IncomingCallUiLauncher.scheduleAfterForeground(
        handler, context, callId, callerName, callerAvatar, callType);
  }

  /**
   * Single authoritative incoming-call notification builder (FGS + notifier fallback).
   * Ring/haptics remain in {@link GywIncomingCallAlerts} only.
   */
  public static Notification buildIncomingCallNotification(
      Context context,
      String callId,
      String callerName,
      String callerAvatar,
      String callTypeRaw,
      boolean fullScreenMode) {
    return buildIncomingCallNotification(
        context, callId, callerName, callerAvatar, callTypeRaw, fullScreenMode, fullScreenMode);
  }

  /**
   * @param attachFullScreenIntent when false, notification is backup-only (direct activity launch
   *     is primary — avoids OEM heads-up replacing full-screen UI).
   */
  public static Notification buildIncomingCallNotification(
      Context context,
      String callId,
      String callerName,
      String callerAvatar,
      String callTypeRaw,
      boolean fullScreenMode,
      boolean attachFullScreenIntent) {
    String normalizedType = normalizeCallType(callTypeRaw);
    boolean video = isVideoCallType(normalizedType);
    String title = video ? "Incoming video call" : "Incoming voice call";
    int smallIcon = incomingCallSmallIcon(context, video);
    int reqBase = requestCodesBase(callId);
    int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    Intent contentIntent =
        IncomingCallActivity.buildShowIntent(
            context, callId, callerName, callerAvatar, callTypeRaw);
    PendingIntent contentPi = activityPendingIntent(context, reqBase, contentIntent);

    Intent fullScreenIntent =
        IncomingCallActivity.buildShowIntent(
            context, callId, callerName, callerAvatar, callTypeRaw);
    PendingIntent fullScreenPi =
        activityPendingIntent(context, reqBase + 1, fullScreenIntent, true);

    Intent acceptBroadcast = new Intent(context, GywCallNotificationActionReceiver.class);
    acceptBroadcast.setAction(GywCallNotificationActionReceiver.ACTION_ACCEPT);
    acceptBroadcast.setPackage(context.getPackageName());
    acceptBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_ID, callId);
    acceptBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_TYPE, normalizedType);
    PendingIntent acceptPi =
        PendingIntent.getBroadcast(context, reqBase + 2, acceptBroadcast, piFlags);

    Intent declineBroadcast = new Intent(context, GywCallNotificationActionReceiver.class);
    declineBroadcast.setAction(GywCallNotificationActionReceiver.ACTION_DECLINE);
    declineBroadcast.setPackage(context.getPackageName());
    declineBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_ID, callId);
    declineBroadcast.putExtra(GywCallNotificationActionReceiver.EXTRA_CALL_TYPE, normalizedType);
    PendingIntent declinePi =
        PendingIntent.getBroadcast(context, reqBase + 3, declineBroadcast, piFlags);

    boolean attachFullScreen =
        fullScreenMode
            && attachFullScreenIntent
            && IncomingCallPathConfig.mayUseFullScreenIntent();
    boolean canUseFsi = canUseFullScreenIntent(context);
    boolean notificationFirst =
        IncomingCallPathConfig.HYBRID_INCOMING_CALL_MODE
            && IncomingCallProcessState.isRestrictiveEnvironment(context);

    Bitmap avatarBitmap = resolveCallerAvatarBitmap(context, callerAvatar, callerName, video);
    int accentColor = video ? 0xFF1565C0 : 0xFF2E7D32;
    String typeLabel = video ? "VIDEO CALL" : "AUDIO CALL";

    Person.Builder personBuilder =
        new Person.Builder().setName(callerName).setImportant(true);
    if (avatarBitmap != null) {
      personBuilder.setIcon(
          androidx.core.graphics.drawable.IconCompat.createWithBitmap(avatarBitmap));
    }
    Person caller = personBuilder.build();

    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(smallIcon)
            .setContentTitle(title)
            .setContentText(callerName)
            .setSubText(typeLabel)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setDefaults(0)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentPi)
            .setColor(accentColor)
            .setColorized(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setUsesChronometer(true);

    if (avatarBitmap != null) {
      b.setLargeIcon(avatarBitmap);
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declinePi, acceptPi));
      Log.d(TAG, "NOTIFICATION_STYLE=CallStyle callType=" + normalizedType);
    } else {
      b.setStyle(
          new NotificationCompat.BigTextStyle()
              .bigText(callerName + "\n" + typeLabel)
              .setBigContentTitle(title));
      b.addAction(android.R.drawable.sym_action_call, "Accept", acceptPi)
          .addAction(
              android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi);
      Log.d(TAG, "NOTIFICATION_STYLE=BigTextActions callType=" + normalizedType);
    }

    b.setSilent(true);

    if (attachFullScreen && !notificationFirst) {
      b.setFullScreenIntent(fullScreenPi, true);
    }

    if (Build.VERSION.SDK_INT >= 34) {
      b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
    }

    Notification built = b.build();
    Log.d(
        TAG,
        "CALL_TYPE="
            + normalizedType
            + " CALL_NOTIFICATION_CHANNEL="
            + CHANNEL_ID
            + " CALL_NOTIFICATION_CATEGORY="
            + NotificationCompat.CATEGORY_CALL
            + " FULLSCREEN_NOTIFICATION_ATTACHED="
            + attachFullScreen
            + " CALL_FULLSCREEN_ATTACHED="
            + attachFullScreen
            + " canUseFSI="
            + canUseFsi
            + " CALL_NOTIFICATION_ID="
            + ACTIVE_INCOMING_CALL_NOTIFICATION_ID
            + " tag="
            + NOTIFICATION_TAG
            + " callId="
            + callId
            + " fullScreenMode="
            + fullScreenMode);

    return built;
  }

  /**
   * Minimal silent notification for {@link GywIncomingCallService} when IncomingCallActivity is
   * launched directly. IMPORTANCE_LOW prevents heads-up from stealing lockscreen focus.
   */
  public static Notification buildSilentPhoneCallServiceNotification(
      Context context, String callId, String callerName, String callTypeRaw) {
    ensureServiceChannel(context);
    String normalizedType = normalizeCallType(callTypeRaw);
    boolean video = isVideoCallType(normalizedType);
    String name = callerName != null && !callerName.isEmpty() ? callerName : "Incoming call";
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(context, SERVICE_CHANNEL_ID)
            .setSmallIcon(incomingCallSmallIcon(context, video))
            .setContentTitle(video ? "Incoming video call" : "Incoming voice call")
            .setContentText(name)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setDefaults(0);
    if (Build.VERSION.SDK_INT >= 34) {
      b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
    }
    Log.d(
        TAG,
        "SILENT_FGS_NOTIFICATION callId="
            + callId
            + " channel="
            + SERVICE_CHANNEL_ID
            + " noFSI=true noHeadsUp=true");
    return b.build();
  }

  /** Low-importance channel for FGS — must not trigger heads-up over lockscreen activity. */
  public static void ensureServiceChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (nm.getNotificationChannel(SERVICE_CHANNEL_ID) != null) return;
    NotificationChannel ch =
        new NotificationChannel(
            SERVICE_CHANNEL_ID, "Phone call service", NotificationManager.IMPORTANCE_LOW);
    ch.setDescription("Silent ongoing notification while incoming call UI is shown");
    ch.setSound(null, null);
    ch.enableVibration(false);
    ch.setShowBadge(false);
    ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
    nm.createNotificationChannel(ch);
    Log.d(TAG, "Created silent service channel " + SERVICE_CHANNEL_ID);
  }

  private static int processImportance(Context context) {
    ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null) return ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE;
    String pkg = context.getPackageName();
    for (ActivityManager.RunningAppProcessInfo proc : am.getRunningAppProcesses()) {
      if (proc != null && pkg.equals(proc.processName)) {
        return proc.importance;
      }
    }
    return ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE;
  }

  private static boolean isDefaultDisplayOff(Context context) {
    try {
      DisplayManager dm = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
      if (dm == null) return false;
      Display display = dm.getDisplay(Display.DEFAULT_DISPLAY);
      return display != null && display.getState() == Display.STATE_OFF;
    } catch (Exception e) {
      return false;
    }
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
    // Only finish a *previous* call UI — a blanket finish broadcast races the new launch and
    // instantly destroys IncomingCallActivity on Tecno/Oppo/Xiaomi (heads-up-only symptom).
    String previousCallId = activeCallId(app);
    if (previousCallId != null && !previousCallId.isEmpty()) {
      sendFinishIncomingActivityBroadcast(app, previousCallId);
    }
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
              || LEGACY_CHANNEL_ID_V2.equals(ch)
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
      for (String legacyId :
          new String[] {
            LEGACY_CHANNEL_ID_V2,
            LEGACY_CHANNEL_ID_V5,
            LEGACY_CHANNEL_ID_V7
          }) {
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
  /**
   * After accept: stop ring + notification + FGS without disconnecting Telecom (call stays active).
   */
  public static void dismissIncomingUiAfterAccept(Context context, String callId) {
    Context app = context.getApplicationContext();
    Log.d(TAG, "dismissIncomingUiAfterAccept callId=" + callId);
    IncomingCallGuard.markAnswered(app, callId, "dismiss_after_accept");
    IncomingCallUiLauncher.cancelScheduled(
        new android.os.Handler(android.os.Looper.getMainLooper()), callId);
    GywIncomingCallAlerts.stop(app);
    cancel(app, callId);
    Intent stop = new Intent(app, GywIncomingCallService.class);
    stop.setAction(GywIncomingCallService.ACTION_STOP);
    try {
      app.startService(stop);
    } catch (Exception e) {
      Log.w(TAG, "dismissIncomingUiAfterAccept stop service: " + e.getMessage());
    }
  }

  public static void stopRingingAndDismissUi(Context context, String callId) {
    Context app = context.getApplicationContext();
    Log.d(TAG, "CALL_CLEANUP start component=GywIncomingCallNotifier callId=" + callId);
    CallConnectionService.Companion.reportCallEnded(app, callId == null ? "" : callId);
    IncomingCallGuard.release(app, callId, "native_stop_dismiss");
    GywIncomingCallAlerts.stop(app);
    cancel(app, callId);
    sendFinishIncomingActivityBroadcast(app, callId);
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
    launchMainActivityCallDeepLink(context, callId, accept, callType, null);
  }

  public static void launchMainActivityCallDeepLink(
      Context context,
      String callId,
      boolean accept,
      @Nullable String callType,
      @Nullable String callerUid) {
    launchMainActivityCallDeepLink(context, callId, accept, callType, callerUid, null, null);
  }

  public static void launchMainActivityCallDeepLink(
      Context context,
      String callId,
      boolean accept,
      @Nullable String callType,
      @Nullable String callerUid,
      @Nullable String callerName,
      @Nullable String callerAvatar) {
    Context app = context.getApplicationContext();
    String pkg = app.getPackageName();
    String normalizedType = "video".equalsIgnoreCase(callType) ? "video" : "audio";
    String uriStr =
        "gyw://call/"
            + callId
            + (accept ? "?accept=1&callType=" : "?decline=1&callType=")
            + normalizedType;
    // Accept: ACTION_VIEW + gyw:// so Expo Router opens /call/[id]?accept=1 even when JS emit fails.
    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
    intent.setClassName(pkg, pkg + ".MainActivity");
    if (accept) {
      intent.putExtra(IncomingCallModule.EXTRA_CALL_ID, callId);
      intent.putExtra(IncomingCallModule.EXTRA_CALL_TYPE, normalizedType);
      intent.putExtra(IncomingCallModule.EXTRA_ACCEPTED, true);
      intent.putExtra(IncomingCallModule.EXTRA_AUTO_ACCEPT, true);
      if (callerUid != null && !callerUid.isEmpty()) {
        intent.putExtra(IncomingCallModule.EXTRA_CALLER_UID, callerUid);
      }
      if (callerName != null && !callerName.isEmpty()) {
        intent.putExtra(IncomingCallModule.EXTRA_CALLER_NAME, callerName);
      }
      if (callerAvatar != null && !callerAvatar.isEmpty()) {
        intent.putExtra(IncomingCallModule.EXTRA_CALLER_PHOTO_URL, callerAvatar);
        intent.putExtra(IncomingCallActivity.EXTRA_CALLER_AVATAR, callerAvatar);
      }
    }
    intent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      intent.addFlags(FLAG_SHOW_WHEN_LOCKED | FLAG_TURN_SCREEN_ON);
    }
    Log.w(
        TAG,
        "ACCEPT_DEEPLINK_START callId="
            + callId
            + " accept="
            + accept
            + " action="
            + intent.getAction()
            + " callType="
            + normalizedType);
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

  private static void sendFinishIncomingActivityBroadcast(Context app, @Nullable String callId) {
    try {
      Intent i = new Intent(IncomingCallActivity.ACTION_FINISH_INCOMING_UI);
      i.setPackage(app.getPackageName());
      if (callId != null && !callId.isEmpty()) {
        i.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
        i.putExtra(IncomingCallActivity.EXTRA_CHAT_ID, callId);
      }
      app.sendBroadcast(i);
      Log.d(TAG, "FINISH_INCOMING_UI_BROADCAST callId=" + callId);
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

    String callTypeRaw = normalizeCallType(data.getString("callType"));

    if (fullScreenIncomingUi) {
      acquireWakeLock(context);
      Log.d(TAG, "SCREEN_WAKE_TRIGGERED source=notifier callId=" + callId);
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

    Log.d(
        TAG,
        "CALL_UI_MODE = " + (fullScreenIncomingUi ? "FULLSCREEN_LOCKED" : "HEADSUP_UNLOCKED"));

    Notification notification =
        buildIncomingCallNotification(
            context,
            callId,
            callerName,
            data.getString("callerAvatar"),
            callTypeRaw,
            fullScreenIncomingUi);

    try {
      nm.notify(NOTIFICATION_TAG, ACTIVE_INCOMING_CALL_NOTIFICATION_ID, notification);
      Log.d(TAG, "CALL_NOTIFICATION_SHOWN source=notifier callId=" + callId);
      if (fullScreenIncomingUi && IncomingCallPathConfig.mayScheduleActivityRetries()) {
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        IncomingCallUiLauncher.scheduleFallback(
            h,
            context,
            callId,
            callerName,
            data.getString("callerAvatar"),
            callTypeRaw);
      }
      GywIncomingCallAlerts.start(context, callId, callTypeRaw);
      rememberActiveCallId(context.getApplicationContext(), callId);
    } catch (SecurityException e) {
      Log.e(TAG, "nm.notify() denied — POST_NOTIFICATIONS not granted?", e);
      GywIncomingCallAlerts.start(context, callId, callTypeRaw);
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
   * Creates the high-importance incoming-call channel (silent — ring in GywIncomingCallAlerts).
   * Safe to call from {@link GywIncomingCallService} — no-op if the channel already exists.
   */
  public static void ensureIncomingCallChannel(Context context, NotificationManager nm) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    if (nm == null) return;

    for (String legacyId :
        new String[] {
          "call_channel_v3",
          "incoming_calls_v2",
          LEGACY_CHANNEL_ID_V2,
          LEGACY_CHANNEL_ID_V5,
          LEGACY_CHANNEL_ID_V7
        }) {
      try {
        nm.deleteNotificationChannel(legacyId);
      } catch (Exception ignored) {
      }
    }

    NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
    if (existing != null) {
      if (existing.getImportance() < NotificationManager.IMPORTANCE_HIGH) {
        Log.w(
            TAG,
            "Recreating degraded call channel "
                + CHANNEL_ID
                + " importance="
                + existing.getImportance());
        try {
          nm.deleteNotificationChannel(CHANNEL_ID);
        } catch (Exception ignored) {
        }
        existing = null;
      } else {
        Log.d(
            TAG,
            "Channel already exists: "
                + CHANNEL_ID
                + " importance="
                + existing.getImportance()
                + " sound="
                + existing.getSound()
                + " vibration="
                + existing.shouldVibrate());
        return;
      }
    }
    Log.d(TAG, "Creating channel: " + CHANNEL_ID);

    NotificationChannel ch =
        new NotificationChannel(
            CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
    ch.setDescription("Incoming voice and video calls");
    ch.setSound(null, null);
    ch.enableVibration(false);
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

  /** {@code res/drawable/ic_call_audio|ic_call_video} from prebuild plugin. */
  public static int incomingCallSmallIcon(Context context, boolean video) {
    String name = video ? "ic_call_video" : "ic_call_audio";
    int id =
        context.getResources().getIdentifier(name, "drawable", context.getPackageName());
    if (id != 0) return id;
    return video ? android.R.drawable.ic_menu_camera : android.R.drawable.sym_action_call;
  }

  private static String activeCallId(Context context) {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_ACTIVE_CALL_ID, null);
  }

  /** @see #rememberActiveCallId */
  public static void rememberActiveCallIdPublic(Context context, String callId) {
    rememberActiveCallId(context, callId);
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

  @Nullable
  private static Bitmap resolveCallerAvatarBitmap(
      Context context, @Nullable String avatarUrl, String callerName, boolean video) {
    Bitmap fromUrl = null;
    if (avatarUrl != null && !avatarUrl.trim().isEmpty()) {
      fromUrl = downloadAvatarBitmap(avatarUrl.trim());
    }
    if (fromUrl != null) return fromUrl;
    return letterAvatarBitmap(context, callerName, video);
  }

  @Nullable
  private static Bitmap downloadAvatarBitmap(String urlStr) {
    java.net.HttpURLConnection conn = null;
    try {
      java.net.URL url = new java.net.URL(urlStr);
      conn = (java.net.HttpURLConnection) url.openConnection();
      conn.setConnectTimeout(1200);
      conn.setReadTimeout(1200);
      conn.connect();
      java.io.InputStream in = conn.getInputStream();
      Bitmap raw = BitmapFactory.decodeStream(in);
      if (raw == null) return null;
      int size = 256;
      int w = raw.getWidth();
      int h = raw.getHeight();
      if (w <= 0 || h <= 0) return raw;
      float scale = Math.min((float) size / w, (float) size / h);
      int nw = Math.max(1, Math.round(w * scale));
      int nh = Math.max(1, Math.round(h * scale));
      return Bitmap.createScaledBitmap(raw, nw, nh, true);
    } catch (Exception e) {
      Log.d(TAG, "avatar download failed: " + e.getMessage());
      return null;
    } finally {
      if (conn != null) conn.disconnect();
    }
  }

  private static Bitmap letterAvatarBitmap(Context context, String name, boolean video) {
    int size = 256;
    Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    int bg = video ? 0xFF1565C0 : 0xFF2E7D32;
    canvas.drawColor(bg);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(0xFFFFFFFF);
    paint.setTextSize(size * 0.42f);
    paint.setTypeface(Typeface.DEFAULT_BOLD);
    paint.setTextAlign(Paint.Align.CENTER);
    String letter = "?";
    if (name != null && !name.isEmpty()) {
      letter = name.trim().substring(0, 1).toUpperCase();
    }
    canvas.drawText(letter, size / 2f, size * 0.62f, paint);
    return bmp;
  }
}
