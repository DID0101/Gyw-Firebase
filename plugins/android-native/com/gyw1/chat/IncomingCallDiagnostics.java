package com.gyw1.chat;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.util.Log;
import java.util.List;

/** Evidence logs for lockscreen / fullscreen root-cause isolation. */
public final class IncomingCallDiagnostics {
  private static final String TAG = "IncomingCallDiag";

  private IncomingCallDiagnostics() {}

  public static void logDeviceLockState(Context context, String tag) {
    KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
    PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
    boolean keyguardLocked = km != null && km.isKeyguardLocked();
    boolean deviceLocked =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && km != null && km.isDeviceLocked();
    boolean interactive = pm != null && pm.isInteractive();
    Log.w(
        tag,
        "ON_SHOW_UI_DEVICE_LOCKED="
            + deviceLocked
            + " keyguardLocked="
            + keyguardLocked
            + " ON_SHOW_UI_SCREEN_INTERACTIVE="
            + interactive);
  }

  /** Dumps top resumed activity in this app's task stack. */
  public static void logTopActivity(Context context, String tag, String expectedClass) {
    try {
      ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
      if (am == null) {
        Log.w(tag, "ACTIVITY_IS_TOP=false reason=no_activity_manager");
        return;
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        List<ActivityManager.AppTask> tasks = am.getAppTasks();
        if (tasks == null || tasks.isEmpty()) {
          Log.w(tag, "ACTIVITY_IS_TOP=false reason=no_app_tasks");
          return;
        }
        for (ActivityManager.AppTask task : tasks) {
          ActivityManager.RecentTaskInfo info = task.getTaskInfo();
          if (info == null || info.topActivity == null) continue;
          String top = info.topActivity.getClassName();
          boolean isTop = top.equals(expectedClass);
          Log.w(
              tag,
              "ACTIVITY_IS_TOP="
                  + isTop
                  + " TOP_ACTIVITY="
                  + top
                  + " expected="
                  + expectedClass
                  + " taskId="
                  + info.taskId);
        }
        return;
      }
      Log.w(tag, "ACTIVITY_IS_TOP=unknown reason=api_lt_m");
    } catch (Exception e) {
      Log.w(tag, "ACTIVITY_IS_TOP=false top_activity_probe_failed=" + e.getMessage());
    }
  }

  /** Phase 6 — self-managed accounts + CallKeep conflict check. */
  public static void logSelfManagedPhoneAccounts(Context context, String tag) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    try {
      TelecomManager tm = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
      if (tm == null) return;

      List<PhoneAccountHandle> capable = tm.getCallCapablePhoneAccounts();
      int selfManagedCount = 0;
      boolean callKeepPresent = false;
      boolean gywPresent = false;

      if (capable != null) {
        for (PhoneAccountHandle handle : capable) {
          PhoneAccount account = tm.getPhoneAccount(handle);
          if (account == null) continue;
          String component =
              handle.getComponentName() != null ? handle.getComponentName().getClassName() : "?";
          boolean selfManaged =
              (account.getCapabilities() & PhoneAccount.CAPABILITY_SELF_MANAGED)
                  == PhoneAccount.CAPABILITY_SELF_MANAGED;
          boolean isGyw = component.contains("CallConnectionService");
          boolean isCallKeep =
              component.contains("VoiceConnectionService") || component.contains("callkeep");
          if (selfManaged) selfManagedCount++;
          if (isGyw) gywPresent = true;
          if (isCallKeep) callKeepPresent = true;
          Log.d(
              tag,
              "PHONE_ACCOUNT id="
                  + handle.getId()
                  + " component="
                  + component
                  + " selfManaged="
                  + selfManaged
                  + " isGyw="
                  + isGyw
                  + " isCallKeep="
                  + isCallKeep);
        }
      }

      Log.w(
          tag,
          "SELF_MANAGED_PHONE_ACCOUNT_COUNT="
              + selfManagedCount
              + " GYW_PHONEACCOUNT_PRESENT="
              + gywPresent
              + " CALLKEEP_PHONEACCOUNT_PRESENT="
              + callKeepPresent);

      if (Build.VERSION.SDK_INT >= 34) {
        try {
          List<PhoneAccountHandle> ownSelfManaged = tm.getOwnSelfManagedPhoneAccounts();
          Log.w(
              tag,
              "getOwnSelfManagedPhoneAccounts count="
                  + (ownSelfManaged != null ? ownSelfManaged.size() : 0));
        } catch (Throwable t) {
          Log.w(tag, "getOwnSelfManagedPhoneAccounts failed: " + t.getMessage());
        }
      }
    } catch (Exception e) {
      Log.w(tag, "logSelfManagedPhoneAccounts failed: " + e.getMessage());
    }
  }

  /**
   * Emit a single evidence-backed verdict tag after collecting logs.
   * Call from IncomingCallActivity.onResume when diagnostics complete.
   */
  public static void emitVisibilityVerdict(
      String tag,
      boolean onShowUiFired,
      boolean activityOnCreate,
      boolean activityOnResume,
      boolean windowFocus,
      boolean deviceLocked) {
    String blocker;
    if (!onShowUiFired) {
      blocker = "FINAL_BLOCKER=A_TELECOM_CALLBACK_NEVER_FIRES";
    } else if (activityOnCreate && !activityOnResume) {
      blocker = "FINAL_BLOCKER=B_ACTIVITY_LAUNCH_OEM_HIDES_NO_RESUME";
    } else if (activityOnResume && !windowFocus && deviceLocked) {
      blocker = "FINAL_BLOCKER=B_OEM_KEYGUARD_HIDES_WINDOW";
    } else if (activityOnResume && windowFocus) {
      blocker = "FINAL_BLOCKER=NONE_UI_SHOULD_BE_VISIBLE_CHECK_THEME_OVERLAY";
    } else if (!activityOnCreate) {
      blocker = "FINAL_BLOCKER=F_ACTIVITY_NEVER_STARTED";
    } else {
      blocker = "FINAL_BLOCKER=UNKNOWN_COLLECT_MORE_LOGS";
    }
    Log.e(tag, blocker);
  }
}
