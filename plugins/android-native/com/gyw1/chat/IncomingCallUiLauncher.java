package com.gyw1.chat;

import android.app.ActivityManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Single authoritative path for showing {@link IncomingCallActivity}.
 *
 * <p>WhatsApp/Signal-style flow: foreground phone-call service stabilizes first, then we launch
 * the activity directly from the service context. Notification full-screen intent is backup only.
 */
public final class IncomingCallUiLauncher {
  private static final String TAG = "IncomingCallUiLauncher";

  /** First attempt after {@code startForeground()} — cold-start OEMs need 300–600ms. */
  private static final long FIRST_LAUNCH_AFTER_FOREGROUND_MS = 500L;

  /** Additional OEM retries (Tecno / Oppo / Xiaomi / Realme). */
  private static final long[] OEM_RETRY_DELAYS_MS = {900L, 1600L, 2800L, 4200L};

  private static final Map<String, List<Runnable>> scheduledByCallId = new ConcurrentHashMap<>();

  @Nullable private static volatile String lastLaunchedCallId;

  private IncomingCallUiLauncher() {}

  /**
   * Schedule direct activity launches after the phone-call FGS has called {@code startForeground()}.
   */
  public static void scheduleAfterForeground(
      Handler handler,
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType) {
    if (!IncomingCallPathConfig.mayScheduleActivityRetries()) {
      Log.w(TAG, "scheduleAfterForeground BLOCKED hybrid/no_retries");
      return;
    }
    cancelScheduled(handler, callId);
    List<Runnable> pending = new ArrayList<>();
    scheduledByCallId.put(callId, pending);

    Runnable first =
        () -> {
          Log.d(
              TAG,
              "ACTIVITY_LAUNCH_AFTER_FOREGROUND callId="
                  + callId
                  + " ACTIVITY_LAUNCH_DELAY_MS="
                  + FIRST_LAUNCH_AFTER_FOREGROUND_MS
                  + " FOREGROUND_STABLE=true");
          launchDirect(context, callId, callerName, callerAvatar, callType, "after_foreground");
        };
    pending.add(first);
    handler.postDelayed(first, FIRST_LAUNCH_AFTER_FOREGROUND_MS);

    for (long delay : OEM_RETRY_DELAYS_MS) {
      Runnable retry =
          () -> {
            String visibleId = IncomingCallActivity.getVisibleCallId();
            if (visibleId != null
                && visibleId.equals(callId)
                && callId.equals(lastLaunchedCallId)) {
              Log.d(
                  TAG,
                  "OEM_RETRY_LAUNCH skipped=ui_visible callId=" + callId + " delayMs=" + delay);
              return;
            }
            Log.d(TAG, "OEM_RETRY_LAUNCH delayMs=" + delay + " callId=" + callId);
            launchDirect(context, callId, callerName, callerAvatar, callType, "oem_retry_" + delay);
          };
      pending.add(retry);
      handler.postDelayed(retry, delay);
    }
  }

  /** Notifier-only fallback when {@link GywIncomingCallService} could not start. */
  public static void scheduleFallback(
      Handler handler,
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType) {
    cancelScheduled(handler, callId);
    List<Runnable> pending = new ArrayList<>();
    scheduledByCallId.put(callId, pending);

    long[] delays = {0L, 200L, 500L, 1000L};
    for (long delay : delays) {
      Runnable attempt =
          () -> {
            if (delay > 0) {
              Log.d(TAG, "OEM_RETRY_LAUNCH delayMs=" + delay + " callId=" + callId + " path=fallback");
            }
            launchDirect(
                context, callId, callerName, callerAvatar, callType, "notifier_fallback_" + delay);
          };
      pending.add(attempt);
      handler.postDelayed(attempt, delay);
    }
  }

  public static void cancelScheduled(Handler handler, @Nullable String callId) {
    if (callId == null || callId.isEmpty()) return;
    List<Runnable> pending = scheduledByCallId.remove(callId);
    if (pending == null) return;
    for (Runnable r : pending) {
      handler.removeCallbacks(r);
    }
  }

  /**
   * Direct {@link IncomingCallActivity} launch — must not rely on notification FSI.
   *
   * @return true if {@code startActivity} was invoked without throwing
   */
  public static boolean launchDirect(
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType,
      String source) {
    return launchDirect(context, callId, callerName, callerAvatar, callType, source, null);
  }

  public static boolean launchDirect(
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType,
      String source,
      @Nullable String callerUid) {
    return launchDirect(
        context, callId, callerName, callerAvatar, callType, source, callerUid, null);
  }

  public static boolean launchDirect(
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType,
      String source,
      @Nullable String callerUid,
      @Nullable String callerPhone) {
    if (!IncomingCallPathConfig.mayLaunchActivity(context, source)) {
      return false;
    }
    if (callId == null || callId.isEmpty()) return false;
    if (IncomingCallGuard.isAnswered(context, callId)) {
      Log.d(
          TAG,
          "INCOMING_UI_BLOCKED source="
              + source
              + " callId="
              + callId
              + " reason=answered");
      return false;
    }
    if (callerName == null || callerName.isEmpty()) callerName = "Incoming call";
    callType = GywIncomingCallNotifier.normalizeCallType(callType);
    boolean video = GywIncomingCallNotifier.isVideoCallType(callType);

    logProcessState(context, "DIRECT_ACTIVITY_LAUNCH_START source=" + source + " callId=" + callId);
    Log.d(TAG, "CALL_TYPE=" + callType + " FULLSCREEN_PATH_SELECTED=true");
    Log.d(
        TAG,
        video ? "DIRECT_ACTIVITY_LAUNCH_VIDEO" : "DIRECT_ACTIVITY_LAUNCH_AUDIO");
    Log.d(
        TAG,
        "DIRECT_ACTIVITY_LAUNCH_START source="
            + source
            + " callId="
            + callId
            + " ctx="
            + context.getClass().getSimpleName());

    Intent launch =
        IncomingCallActivity.buildShowIntent(
            context, callId, callerName, callerAvatar, callType, callerUid, callerPhone);
    Log.d(
        TAG,
        "CALL_PAYLOAD callId="
            + callId
            + " callerName="
            + callerName
            + " callerAvatar="
            + (callerAvatar != null ? callerAvatar : "")
            + " callerUid="
            + (callerUid != null ? callerUid : ""));
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      launch.addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
    }
    launch.addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION);
    if (!video) {
      launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    }

    Bundle opts = GywIncomingCallNotifier.backgroundDirectStartBundle();
    try {
      if (context instanceof Service) {
        if (opts != null) {
          context.startActivity(launch, opts);
        } else {
          context.startActivity(launch);
        }
      } else if (context instanceof android.app.Activity) {
        // Foreground RN: start from the live Activity (no application-context launch).
        launch.setFlags(launch.getFlags() & ~Intent.FLAG_ACTIVITY_NEW_TASK);
        ((android.app.Activity) context).startActivity(launch);
      } else {
        Context app = context.getApplicationContext();
        if (opts != null) {
          app.startActivity(launch, opts);
        } else {
          app.startActivity(launch);
        }
      }
      lastLaunchedCallId = callId;
      Log.w(TAG, "FULLSCREEN_ATTEMPTED=true launchDispatched=true source=" + source + " callId=" + callId);
      Log.d(TAG, "DIRECT_ACTIVITY_LAUNCH_SUCCESS source=" + source + " callId=" + callId);
      logFullscreenAttemptResult(context, callId, true, 500L);
      return true;
    } catch (Throwable t) {
      Log.e(TAG, "DIRECT_ACTIVITY_LAUNCH_FAILED source=" + source + " callId=" + callId, t);
      Log.w(TAG, "FULLSCREEN_ATTEMPTED=true launchDispatched=false callId=" + callId);
      logFullscreenAttemptResult(context, callId, false, 500L);
      return false;
    }
  }

  /** @deprecated Use {@link #launchDirect} — kept for older call sites. */
  @Deprecated
  public static void launchFullScreenIncomingActivity(
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType,
      String source) {
    launchDirect(context, callId, callerName, callerAvatar, callType, source);
  }

  private static void logProcessState(Context context, String prefix) {
    Context app = context.getApplicationContext();
    int importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE;
    ActivityManager am = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
    if (am != null && am.getRunningAppProcesses() != null) {
      String pkg = app.getPackageName();
      for (ActivityManager.RunningAppProcessInfo proc : am.getRunningAppProcesses()) {
        if (proc != null && pkg.equals(proc.processName)) {
          importance = proc.importance;
          break;
        }
      }
    }
    boolean processColdStart =
        importance >= ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED;
    boolean fgsActive = context instanceof Service;
    PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
    boolean interactive = pm != null && pm.isInteractive();
    boolean deviceIdle = false;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && pm != null) {
      deviceIdle = pm.isDeviceIdleMode();
    }
    boolean batteryOptIgnored = true;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      batteryOptIgnored = pm != null && pm.isIgnoringBatteryOptimizations(app.getPackageName());
    }
    boolean bgRestricted = false;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && am != null) {
      bgRestricted = am.isBackgroundRestricted();
    }
    boolean oemBlockLikely = isRestrictiveOem() && (processColdStart || bgRestricted || !batteryOptIgnored);
    Log.d(
        TAG,
        prefix
            + " PROCESS_IMPORTANCE="
            + importance
            + " PROCESS_COLD_START="
            + processColdStart
            + " FOREGROUND_SERVICE_ACTIVE="
            + fgsActive
            + " SCREEN_INTERACTIVE="
            + interactive
            + " DEVICE_IDLE="
            + deviceIdle
            + " BATTERY_OPT_IGNORED="
            + batteryOptIgnored
            + " BG_RESTRICTED="
            + bgRestricted
            + " OEM_BLOCK_DETECTED="
            + oemBlockLikely
            + " OEM="
            + Build.MANUFACTURER);
  }

  /** Post-launch probe — fullscreen visible vs notification backup (Phase 3). */
  public static void logFullscreenAttemptResult(
      Context context, String callId, boolean launchDispatched, long delayMs) {
    Handler handler = new Handler(android.os.Looper.getMainLooper());
    handler.postDelayed(
        () -> {
          String visibleId = IncomingCallActivity.getVisibleCallId();
          boolean resumed = callId.equals(visibleId);
          boolean windowFocus = IncomingCallActivity.hasWindowFocusForCall(callId);
          boolean fullscreenVisible = resumed && windowFocus;
          boolean fallbackActive = GywIncomingCallNotifier.hasActiveIncomingCallUi(context);
          logProcessState(context, "POST_LAUNCH_VISIBILITY_PROBE");
          Log.w(
              TAG,
              "FULLSCREEN_ATTEMPTED=true launchDispatched="
                  + launchDispatched
                  + " FULLSCREEN_VISIBLE="
                  + fullscreenVisible
                  + " activityResumed="
                  + resumed
                  + " windowFocus="
                  + windowFocus
                  + " FALLBACK_NOTIFICATION_ACTIVE="
                  + fallbackActive
                  + " callId="
                  + callId);
          Log.d(
              TAG,
              "CALL_ACTIVITY_VISIBLE="
                  + resumed
                  + " expectedCallId="
                  + callId
                  + " visibleCallId="
                  + visibleId);
        },
        delayMs);
  }

  /** @deprecated Use {@link #logFullscreenAttemptResult}. */
  @Deprecated
  public static void logActivityVisibilityAfterLaunch(
      Context context, String callId, long delayMs) {
    logFullscreenAttemptResult(context, callId, true, delayMs);
  }

  private static boolean isRestrictiveOem() {
    String m = Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase() : "";
    String b = Build.BRAND != null ? Build.BRAND.toLowerCase() : "";
    return m.contains("tecno")
        || m.contains("infinix")
        || m.contains("itel")
        || m.contains("oppo")
        || m.contains("realme")
        || m.contains("vivo")
        || m.contains("xiaomi")
        || m.contains("redmi")
        || m.contains("poco")
        || b.contains("tecno")
        || b.contains("infinix")
        || b.contains("oppo")
        || b.contains("realme")
        || b.contains("vivo")
        || b.contains("xiaomi");
  }

  /** @deprecated Use {@link #scheduleAfterForeground}. */
  @Deprecated
  public static void scheduleFullScreenActivityRetries(
      Handler handler,
      Context context,
      String callId,
      String callerName,
      @Nullable String callerAvatar,
      String callType) {
    scheduleAfterForeground(handler, context, callId, callerName, callerAvatar, callType);
  }
}
