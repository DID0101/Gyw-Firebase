package com.gyw1.chat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.util.HashMap;
import java.util.Map;

/**
 * Handles notification Accept / Decline actions without flashing {@link IncomingCallActivity}.
 * Stops ring + FGS first, then deep-links into {@code MainActivity} for RN routing.
 */
public final class GywCallNotificationActionReceiver extends BroadcastReceiver {
  private static final String TAG = "GywCallNotificationAction";

  public static final String ACTION_ACCEPT = "com.gyw1.chat.action.ACCEPT_INCOMING_CALL";
  public static final String ACTION_DECLINE = "com.gyw1.chat.action.DECLINE_INCOMING_CALL";
  public static final String EXTRA_CALL_ID = "callId";
  /** Mirrors {@link GywIncomingCallService#EXTRA_CALL_TYPE}. */
  public static final String EXTRA_CALL_TYPE = "callType";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String callId = intent.getStringExtra(EXTRA_CALL_ID);
    if (callId == null || callId.isEmpty()) return;
    String callType = intent.getStringExtra(EXTRA_CALL_TYPE);
    if (callType == null || callType.isEmpty()) callType = "audio";
    String action = intent.getAction();
    boolean accept = ACTION_ACCEPT.equals(action);
    if (!accept && !ACTION_DECLINE.equals(action)) return;

    // IMPORTANT: The small heads-up notification buttons must update the backend
    // immediately. We trigger a headless JS task so React UI is NOT required.
    if (accept) {
      Log.d(TAG, "SMALL_UI_ACCEPT_HEADLESS callId=" + callId);
      Map<String, String> headless = new HashMap<>();
      headless.put("type", "CALL_ACCEPTED");
      headless.put("callId", callId);
      HeadlessCallTask.Companion.start(context.getApplicationContext(), headless);
    } else {
      Log.d(TAG, "SMALL_UI_DECLINE_HEADLESS callId=" + callId);
      Map<String, String> headless = new HashMap<>();
      headless.put("type", "CALL_DECLINED");
      headless.put("callId", callId);
      HeadlessCallTask.Companion.start(context.getApplicationContext(), headless);
    }

    if (accept) {
      Log.d(TAG, "SMALL_UI_ACCEPT callId=" + callId);
      IncomingCallActionHandler.accept(context, callId, callType, "notification", true);
    } else {
      Log.d(TAG, "SMALL_UI_DECLINE callId=" + callId);
      // No need to open RN screen: backend terminal update is handled headlessly above.
      IncomingCallActionHandler.decline(context, callId, callType, "notification", false);
    }
  }
}
