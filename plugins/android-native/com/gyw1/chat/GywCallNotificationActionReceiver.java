package com.gyw1.chat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
/**
 * Handles notification Accept / Decline actions without flashing {@link IncomingCallActivity}.
 * Stops ring + FGS first, then deep-links into {@code MainActivity} for RN routing.
 */
public final class GywCallNotificationActionReceiver extends BroadcastReceiver {
  private static final String TAG = "GywCallNotificationAction";
  private static final long TERMINAL_DEBOUNCE_MS = 2500L;
  private static final java.util.Map<String, Long> lastTerminalHeadlessAt = new java.util.HashMap<>();

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
    final String normalizedCallType = callType;
    String action = intent.getAction();
    boolean accept = ACTION_ACCEPT.equals(action);
    if (!accept && !ACTION_DECLINE.equals(action)) return;
    Log.d(
        TAG,
        (accept ? "CALL_ACCEPT_ACTION" : "CALL_DECLINE_ACTION")
            + " source=notification callId="
            + callId
            + " callType="
            + normalizedCallType);

    // IMPORTANT: The small heads-up notification buttons must update the backend
    // immediately. Native Firestore is primary; headless JS is a fallback/duplicate-safe backup.
    String terminalKey = callId + ":" + (accept ? "accepted" : "declined");
    long now = System.currentTimeMillis();
    synchronized (lastTerminalHeadlessAt) {
      Long last = lastTerminalHeadlessAt.get(terminalKey);
      if (last != null && now - last < TERMINAL_DEBOUNCE_MS) {
        Log.d(TAG, "SKIP duplicate headless terminal callId=" + callId + " accept=" + accept);
        return;
      }
      lastTerminalHeadlessAt.put(terminalKey, now);
    }

    final BroadcastReceiver.PendingResult pendingResult = goAsync();
    final Context app = context.getApplicationContext();
    final boolean accepted = accept;
    if (accept) {
      Log.d(TAG, "SMALL_UI_ACCEPT callId=" + callId);
      IncomingCallActionHandler.accept(context, callId, normalizedCallType, "notification", true);
    } else {
      Log.d(TAG, "SMALL_UI_DECLINE callId=" + callId);
      IncomingCallActionHandler.decline(context, callId, normalizedCallType, "notification", false);
    }
    pendingResult.finish();
  }
}
