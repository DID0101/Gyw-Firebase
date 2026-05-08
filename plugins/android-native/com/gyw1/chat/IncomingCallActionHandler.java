package com.gyw1.chat;

import android.content.Context;
import android.util.Log;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Single native handler for incoming call terminal actions.
 *
 * Keeps action handling idempotent across notification, activity, and telecom callbacks.
 */
public final class IncomingCallActionHandler {
  private static final String TAG = "IncomingCallAction";
  private static final Set<String> terminalCalls =
      Collections.synchronizedSet(new HashSet<>());

  private IncomingCallActionHandler() {}

  public static boolean accept(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchCallScreen) {
    if (callId == null || callId.isEmpty()) return false;
    if (!markTerminalOnce(callId, "accept", source)) return false;

    String normalizedType = "video".equalsIgnoreCase(callType) ? "video" : "audio";
    Log.d(TAG, "CALL_EVENT accept source=" + source + " callId=" + callId + " callType=" + normalizedType);

    GywIncomingCallNotifier.stopRingingAndDismissUi(context, callId);
    IncomingCallBridgeModule.emitIncomingCallAccepted(callId, normalizedType);
    if (launchCallScreen) {
      GywIncomingCallNotifier.launchMainActivityCallDeepLink(context, callId, true, normalizedType);
    }
    Log.d(TAG, "CALL_EVENT cleanup complete action=accept callId=" + callId);
    return true;
  }

  public static boolean decline(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchApp) {
    if (callId == null || callId.isEmpty()) return false;
    if (!markTerminalOnce(callId, "decline", source)) return false;

    String normalizedType = "video".equalsIgnoreCase(callType) ? "video" : "audio";
    Log.d(TAG, "CALL_DECLINE source=" + source + " callId=" + callId);
    Log.d(TAG, "CALL_EVENT decline source=" + source + " callId=" + callId + " callType=" + normalizedType);

    GywIncomingCallNotifier.stopRingingAndDismissUi(context, callId);
    IncomingCallBridgeModule.emitIncomingCallDeclined(callId, normalizedType);
    if (launchApp) {
      GywIncomingCallNotifier.launchMainActivityCallDeepLink(context, callId, false, normalizedType);
    }
    Log.d(TAG, "CALL_EVENT cleanup complete action=decline callId=" + callId);
    return true;
  }

  public static void releaseTerminalLock(String callId, String reason) {
    if (callId == null || callId.isEmpty()) return;
    boolean removed = terminalCalls.remove(callId);
    Log.d(TAG, "CALL_EVENT lock_release callId=" + callId + " reason=" + reason + " removed=" + removed);
  }

  private static boolean markTerminalOnce(String callId, String action, String source) {
    synchronized (terminalCalls) {
      if (terminalCalls.contains(callId)) {
        Log.d(
            TAG,
            "CALL_EVENT " + action + " source=" + source + " callId=" + callId + " ignored=true reason=already_terminal");
        return false;
      }
      terminalCalls.add(callId);
      return true;
    }
  }
}
