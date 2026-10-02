package com.gyw1.chat;

import android.content.Context;
import android.util.Log;

/**
 * Attempt-first hybrid: always try {@link IncomingCallActivity}; premium notification is backup.
 */
public final class IncomingCallPathConfig {
  private static final String TAG = "IncomingCallPathConfig";

  public static final boolean ONLY_TELECOM_MODE_ENABLED = false;
  public static final boolean HYBRID_INCOMING_CALL_MODE = true;
  public static final boolean SINGLE_CONNECTION_SERVICE_MODE = true;
  public static final boolean SYSTEM_UI_ONLY_TEST = false;
  public static final boolean MANAGED_TELECOM_TEST = false;

  private static final String TELECOM_UI_LAUNCH_SOURCE = "telecom_connection_onShowIncomingCallUi";
  public static final String MANAGED_PHONE_ACCOUNT_ID = "gyw_voip_calls_managed";

  private IncomingCallPathConfig() {}

  public static void logActiveMode(String tag) {
    Log.w(
        tag,
        "HYBRID_INCOMING_CALL_MODE="
            + HYBRID_INCOMING_CALL_MODE
            + " policy=attempt_fullscreen_notification_backup");
  }

  public static boolean useManagedTelecomTest() {
    return MANAGED_TELECOM_TEST;
  }

  public static boolean mayLaunchActivity(Context context, String source) {
    if (!HYBRID_INCOMING_CALL_MODE) {
      if (!ONLY_TELECOM_MODE_ENABLED) return true;
      boolean allowed = TELECOM_UI_LAUNCH_SOURCE.equals(source);
      if (!allowed) {
        Log.w(TAG, "ACTIVITY_LAUNCH_BLOCKED source=" + source + " ONLY_TELECOM_MODE=true");
      }
      return allowed;
    }
    if (!IncomingCallProcessState.shouldAttemptFullscreenActivity(context)) {
      return false;
    }
    return true;
  }

  /** Premium notification is always available as backup. */
  public static boolean mayPostIncomingNotification(Context context) {
    if (HYBRID_INCOMING_CALL_MODE) {
      return IncomingCallProcessState.shouldPostPremiumNotificationBackup(context);
    }
    if (!ONLY_TELECOM_MODE_ENABLED) return true;
    Log.w(TAG, "NOTIFICATION_UI_BLOCKED ONLY_TELECOM_MODE=true");
    return false;
  }

  public static boolean mayUseFullScreenIntent() {
    return !HYBRID_INCOMING_CALL_MODE && !ONLY_TELECOM_MODE_ENABLED;
  }

  /** No OEM retry loops — single attempt + visibility probe. */
  public static boolean mayScheduleActivityRetries() {
    return false;
  }

  public static void logPhoneAccountAudit(Context context, String tag) {
    IncomingCallDiagnostics.logSelfManagedPhoneAccounts(context, tag);
  }
}
