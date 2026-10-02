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
    return accept(context, callId, callType, source, launchCallScreen, null);
  }

  public static boolean accept(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchCallScreen,
      @androidx.annotation.Nullable String callerUid) {
    return accept(context, callId, callType, source, launchCallScreen, callerUid, null, null, null);
  }

  public static boolean accept(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchCallScreen,
      @androidx.annotation.Nullable String callerUid,
      @androidx.annotation.Nullable Runnable onUiFinished) {
    return accept(context, callId, callType, source, launchCallScreen, callerUid, null, null, onUiFinished);
  }

  public static boolean accept(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchCallScreen,
      @androidx.annotation.Nullable String callerUid,
      @androidx.annotation.Nullable String callerName,
      @androidx.annotation.Nullable String callerAvatar,
      @androidx.annotation.Nullable Runnable onUiFinished) {
    if (callId == null || callId.isEmpty()) return false;
    Log.w(TAG, "ACCEPT_NATIVE_HANDLER_ENTER source=" + source + " callId=" + callId);
    if (!markTerminalOnce(callId, "accept", source)) {
      Log.w(TAG, "ACCEPT_NATIVE_HANDLER_ENTER ignored=duplicate callId=" + callId);
      return false;
    }

    String normalizedType = "video".equalsIgnoreCase(callType) ? "video" : "audio";
    Log.w(TAG, "ACCEPT_NATIVE_HANDLER_START source=" + source + " callId=" + callId);
    Log.w(TAG, "ACCEPT_HANDLER_START callId=" + callId + " source=" + source);
    IncomingCallGuard.markAnswered(context.getApplicationContext(), callId, "native_accept_" + source);
    IncomingCallUiLauncher.cancelScheduled(new android.os.Handler(android.os.Looper.getMainLooper()), callId);
    CallLatencyTrace.mark(callId, "ACCEPT_CLICKED");
    Log.d(TAG, "CALL_ACCEPT_ACTION source=" + source + " callId=" + callId);
    Log.d(TAG, "CALL_EVENT accept source=" + source + " callId=" + callId + " callType=" + normalizedType);

    // 1. Stop local ring immediately (do not end Telecom connection on accept).
    GywIncomingCallAlerts.stop(context.getApplicationContext());

    // 2. Bring MainActivity to foreground first so ANSWER_CALL intent + getInitialCallIntent
    //    are reliable; then notify JS (emit may no-op if React context is not attached).
    if (launchCallScreen) {
      GywIncomingCallNotifier.launchMainActivityCallDeepLink(
          context,
          callId,
          true,
          normalizedType,
          callerUid,
          callerName,
          callerAvatar);
    }
    IncomingCallBridgeModule.emitIncomingCallAccepted(callId, normalizedType);
    IncomingCallModule.emitAnswerCall(
        callId, normalizedType, callerUid != null ? callerUid : "");

    // 3. Firestore answered (async) — caller stops ringing when write completes.
    Log.d(TAG, "CALL_STATUS_UPDATE_ACCEPTED callId=" + callId);
    Log.w(TAG, "ACCEPT_FIRESTORE_UPDATE_START callId=" + callId + " status=answered");
    NativeCallStateUpdater.updateTerminalState(
        context.getApplicationContext(),
        callId,
        "accepted",
        () -> {
          Log.w(TAG, "CALLER_RECEIVED_ACCEPTED callback callId=" + callId);
          Log.w(TAG, "CALLER_RING_STOP callId=" + callId);

          if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            CallConnectionService.Companion.answerIncomingCall(context.getApplicationContext(), callId);
          }

          GywIncomingCallNotifier.dismissIncomingUiAfterAccept(context, callId);

          Log.d(TAG, "CALL_EVENT cleanup complete action=accept callId=" + callId);
          Log.w(TAG, "ACCEPT_HANDLER_COMPLETE callId=" + callId);
          if (onUiFinished != null) {
            onUiFinished.run();
          }
        });
    return true;
  }

  public static boolean decline(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchApp) {
    return decline(context, callId, callType, source, launchApp, null);
  }

  public static boolean decline(
      Context context,
      String callId,
      String callType,
      String source,
      boolean launchApp,
      @androidx.annotation.Nullable Runnable onUiFinished) {
    if (callId == null || callId.isEmpty()) return false;
    if (!markTerminalOnce(callId, "decline", source)) return false;

    String normalizedType = "video".equalsIgnoreCase(callType) ? "video" : "audio";
    Log.d(TAG, "CALLEE_DECLINE_START source=" + source + " callId=" + callId);
    Log.d(TAG, "CALL_DECLINE_ACTION source=" + source + " callId=" + callId);
    Log.d(TAG, "CALL_EVENT decline source=" + source + " callId=" + callId + " callType=" + normalizedType);

    GywIncomingCallNotifier.stopRingingAndDismissUi(context, callId);

    IncomingCallBridgeModule.emitIncomingCallDeclined(callId, normalizedType);
    IncomingCallModule.emitDeclineCall(callId, normalizedType);
    if (launchApp) {
      GywIncomingCallNotifier.launchMainActivityCallDeepLink(
          context, callId, false, normalizedType);
    }

    Log.d(TAG, "CALL_DB_UPDATE_DECLINED callId=" + callId);
    NativeCallStateUpdater.updateTerminalState(
        context.getApplicationContext(),
        callId,
        "declined",
        () -> {
          Log.d(TAG, "CALL_EVENT cleanup complete action=decline callId=" + callId);
          if (onUiFinished != null) {
            onUiFinished.run();
          }
        });
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
