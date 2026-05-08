package com.gyw1.chat;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.RemoteInput;

/**
 * Notification actions for chat messages only (reply / mark read). Does not interact with call
 * notifications.
 */
public final class GywMessageNotificationActionReceiver extends BroadcastReceiver {
  private static final String TAG = "GywMsgNotifyAction";
  private static final String ACTION_DEDUPE_PREFS = "gyw_msg_action_dedupe";

  public static final String ACTION_MARK_READ = "com.gyw1.chat.action.MSG_MARK_READ";
  public static final String ACTION_REPLY = "com.gyw1.chat.action.MSG_REPLY";

  public static final String EXTRA_CHAT_ID = "chatId";
  public static final String EXTRA_SENDER_ID = "senderId";

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String action = intent.getAction();
    String chatId = intent.getStringExtra(EXTRA_CHAT_ID);
    if (chatId == null || chatId.isEmpty()) return;
    Context app = context.getApplicationContext();

    if (ACTION_MARK_READ.equals(action)) {
      Log.d(TAG, "MSG_ACTION_READ chatId=" + chatId);
      // Native/UI-independent backend update (headless JS), so it works killed/background.
      // Receiver also cancels local notification immediately for instant UX.
      android.os.Bundle headless = new android.os.Bundle();
      headless.putString("type", "MSG_ACTION_READ");
      headless.putString("chatId", chatId);
      HeadlessCallTask.Companion.start(app, toStringMap(headless));

      GywMessageNotifier.cancelForChat(app, chatId);
      Log.d(TAG, "MSG_NOTIFY_UPDATED chatId=" + chatId + " cleared=true");
      return;
    }

    if (ACTION_REPLY.equals(action)) {
      Bundle results = RemoteInput.getResultsFromIntent(intent);
      CharSequence body =
          results != null ? results.getCharSequence(GywMessageNotifier.KEY_TEXT_REPLY) : null;
      String text = body != null ? body.toString().trim() : "";
      String senderId = intent.getStringExtra(EXTRA_SENDER_ID);
      if (senderId == null) senderId = "";

      Log.d(TAG, "MSG_ACTION_REPLY chatId=" + chatId + " text=\"" + text + "\"");

      if (text.isEmpty()) {
        // Nothing to send; still cancel the notification for a clean UX.
        GywMessageNotifier.cancelForChat(app, chatId);
        Log.d(TAG, "MSG_NOTIFY_UPDATED chatId=" + chatId + " cleared=true emptyText=true");
        return;
      }

      // Duplicate tap protection: ignore identical text within a short window.
      if (!shouldProcessReply(app, chatId, text)) {
        Log.d(TAG, "MSG_NOTIFY action=reply suppressed duplicate chatId=" + chatId);
        return;
      }

      // Headless backend send so reply works even when the app is killed.
      android.os.Bundle headless = new android.os.Bundle();
      headless.putString("type", "MSG_ACTION_REPLY");
      headless.putString("chatId", chatId);
      headless.putString("text", text);
      headless.putString("senderId", senderId);
      HeadlessCallTask.Companion.start(app, toStringMap(headless));

      // Instant UX: clear the notification right away.
      GywMessageNotifier.cancelForChat(app, chatId);
      Log.d(TAG, "MSG_NOTIFY_UPDATED chatId=" + chatId + " cleared=true");
    }
  }

  private boolean shouldProcessReply(Context app, String chatId, String text) {
    try {
      android.content.SharedPreferences p = app.getSharedPreferences(ACTION_DEDUPE_PREFS, Context.MODE_PRIVATE);
      String key = "reply_" + chatId + "_" + String.valueOf((chatId + "|" + text).hashCode());
      long now = System.currentTimeMillis();
      long last = p.getLong(key, 0L);
      if (last > 0L && (now - last) < 2000L) {
        return false;
      }
      p.edit().putLong(key, now).apply();
      return true;
    } catch (Exception e) {
      // Non-fatal: if prefs fail, still try to process.
      return true;
    }
  }

  private static java.util.Map<String, String> toStringMap(android.os.Bundle b) {
    java.util.HashMap<String, String> out = new java.util.HashMap<>();
    if (b == null) return out;
    for (String k : b.keySet()) {
      Object v = b.get(k);
      out.put(k, v == null ? "" : String.valueOf(v));
    }
    return out;
  }
}
