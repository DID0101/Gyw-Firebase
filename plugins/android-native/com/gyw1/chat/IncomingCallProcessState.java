package com.gyw1.chat;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import android.view.Display;

/**
 * Incoming-call environment probes. Attempt-first architecture: always try fullscreen activity;
 * premium notification stays active as backup (never notification-only by design).
 */
public final class IncomingCallProcessState {
  private static final String TAG = "IncomingCallProcessState";

  private IncomingCallProcessState() {}

  public static boolean isAppProcessAlive(Context context) {
    int importance = processImportance(context.getApplicationContext());
    boolean alive = importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
    Log.d(TAG, "isAppProcessAlive importance=" + importance + " -> " + alive);
    return alive;
  }

  public static boolean isProcessColdStart(Context context) {
    int importance = processImportance(context.getApplicationContext());
    boolean cold =
        importance >= ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED
            || importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE;
    Log.d(TAG, "isProcessColdStart importance=" + importance + " -> " + cold);
    return cold;
  }

  public static boolean isDeviceLocked(Context context) {
    KeyguardManager km =
        (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
    if (km == null) return false;
    boolean keyguardLocked = km.isKeyguardLocked();
    boolean deviceLocked =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && km.isDeviceLocked();
    boolean locked = deviceLocked || keyguardLocked;
    Log.d(TAG, "isDeviceLocked keyguard=" + keyguardLocked + " device=" + deviceLocked);
    return locked;
  }

  public static boolean isScreenInteractive(Context context) {
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    boolean interactive = pm != null && pm.isInteractive();
    Log.d(TAG, "isScreenInteractive -> " + interactive);
    return interactive;
  }

  public static boolean isDefaultDisplayOff(Context context) {
    try {
      DisplayManager dm =
          (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
      if (dm == null) return false;
      Display display = dm.getDisplay(Display.DEFAULT_DISPLAY);
      return display != null && display.getState() == Display.STATE_OFF;
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * True when device state is likely to block fullscreen (OEM/keyguard). Used for logging and
   * wake — does NOT suppress activity launch.
   */
  public static boolean isRestrictiveEnvironment(Context context) {
    Context app = context.getApplicationContext();
    boolean cold = isProcessColdStart(app);
    boolean locked = isDeviceLocked(app);
    boolean interactive = isScreenInteractive(app);
    boolean displayOff = isDefaultDisplayOff(app);
    boolean restrictive = cold || locked || !interactive || displayOff;
    Log.d(
        TAG,
        "isRestrictiveEnvironment cold="
            + cold
            + " locked="
            + locked
            + " interactive="
            + interactive
            + " displayOff="
            + displayOff
            + " -> "
            + restrictive);
    return restrictive;
  }

  /** Always attempt fullscreen activity in production (WhatsApp/Signal attempt-first). */
  public static boolean shouldAttemptFullscreenActivity(Context context) {
    Log.d(TAG, "shouldAttemptFullscreenActivity=true (attempt-first hybrid)");
    return true;
  }

  /** Premium heads-up notification is always posted as parallel backup. */
  public static boolean shouldPostPremiumNotificationBackup(Context context) {
    Log.d(TAG, "shouldPostPremiumNotificationBackup=true");
    return true;
  }

  /**
   * Early FCM launch before Telecom — only when user is already in app (process visible).
   */
  public static boolean shouldLaunchFromFcmImmediately(Context context) {
    boolean launch = isAppProcessAlive(context) && !isDeviceLocked(context);
    Log.d(TAG, "shouldLaunchFromFcmImmediately -> " + launch);
    return launch;
  }

  /** @deprecated Never use to block activity launch. */
  @Deprecated
  public static boolean shouldUseNotificationFirstUx(Context context) {
    return isRestrictiveEnvironment(context);
  }

  /** @deprecated Use {@link #shouldAttemptFullscreenActivity}. */
  @Deprecated
  public static boolean shouldUseFullscreenActivity(Context context) {
    return shouldAttemptFullscreenActivity(context);
  }

  public static void logIncomingUxContext(Context context, String tag) {
    Context app = context.getApplicationContext();
    Log.w(
        tag,
        "INCOMING_UX_CONTEXT processAlive="
            + isAppProcessAlive(app)
            + " cold="
            + isProcessColdStart(app)
            + " locked="
            + isDeviceLocked(app)
            + " interactive="
            + isScreenInteractive(app)
            + " policy=attempt_fullscreen_with_notification_backup");
  }

  private static int processImportance(Context context) {
    ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null || am.getRunningAppProcesses() == null) {
      return ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE;
    }
    String pkg = context.getPackageName();
    for (ActivityManager.RunningAppProcessInfo proc : am.getRunningAppProcesses()) {
      if (proc != null && pkg.equals(proc.processName)) {
        return proc.importance;
      }
    }
    return ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE;
  }
}
