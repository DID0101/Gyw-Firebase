package com.gyw1.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Chat message notifications only — separate from {@link GywIncomingCallNotifier} (calls).
 *
 * <p>Channels: {@link #CHANNEL_ID}, {@link #CHANNEL_ID_QUIET}. Stable notification tag/id per
 * {@code chatId}. FCM keys: type=chat_message, chatId, senderId, senderName, text, messageId,
 * optional avatar URL, sentAt (millis), unreadCount.
 */
public final class GywMessageNotifier {
  private static final String TAG = "GywMsgNotify";

  /** Keep in sync with {@code CHAT_MESSAGES_ANDROID_CHANNEL_ID} in lib/notifications/constants.ts */
  public static final String CHANNEL_ID = "chat_messages";

  public static final String CHANNEL_ID_QUIET = "chat_messages_quiet";

  public static final String PREFS = "gyw_message_notifications";
  private static final String PREF_FG_CHAT = "foreground_chat_id";
  private static final String PREF_DEDUPE = "seen_message_ids";
  private static final String PREF_UNREAD_PREFIX = "unread_";
  private static final String PREF_PENDING_REPLY = "pending_reply_json";

  public static final String GROUP_KEY_CHATS = "gyw_chat_messages";

  static final String KEY_TEXT_REPLY = "gyw_chat_reply";

  /** Avoid collision with call notification id. */
  private static final int NOTIF_ID_BASE = 0x5200_0000;

  private static final int SUMMARY_ID = 0x5200_FFFE;
  private static final int SUMMARY_PI_REQ = 0x5200_FF00;

  private GywMessageNotifier() {}

  public static void setForegroundChatId(Context context, @Nullable String chatId) {
    context
        .getApplicationContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_FG_CHAT, chatId == null ? "" : chatId)
        .apply();
  }

  public static void setChatUnreadTotal(Context context, int total) {
    context
        .getApplicationContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt("chat_unread_total", Math.max(0, total))
        .apply();
  }

  public static void cancelForChat(Context context, String chatId) {
    if (chatId == null || chatId.isEmpty()) return;
    NotificationManager nm =
        (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    try {
      nm.cancel(notifTag(chatId), notifId(chatId));
      resetUnread(context.getApplicationContext(), chatId);
      Log.d(TAG, "MSG_NOTIFY cleared chatId=" + chatId);
      postGroupSummary(context.getApplicationContext(), nm);
    } catch (Exception e) {
      Log.w(TAG, "cancelForChat: " + e.getMessage());
    }
  }

  public static void handleFcmMessage(Context context, java.util.Map<String, String> data) {
    Context app = context.getApplicationContext();
    String chatId = nz(data.get("chatId"));
    if (chatId.isEmpty()) {
      Log.w(TAG, "MSG_NOTIFY skip reason=no_chatId");
      return;
    }

    String messageId = nz(data.get("messageId"));
    if (messageId.isEmpty()) {
      messageId = "h:" + (nz(data.get("text")) + "|" + chatId + "|" + nz(data.get("sentAt"))).hashCode();
    }
    if (wasRecentlyShown(app, messageId)) {
      Log.d(TAG, "MSG_NOTIFY suppressed=duplicate messageId=" + messageId + " chatId=" + chatId);
      return;
    }

    String fgChat = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_FG_CHAT, "");
    if (!fgChat.isEmpty() && fgChat.equals(chatId)) {
      Log.d(TAG, "MSG_NOTIFY suppressed=chat_open chatId=" + chatId);
      return;
    }

    boolean callActive = GywIncomingCallNotifier.hasActiveIncomingCallUi(app);
    if (callActive) {
      Log.d(TAG, "MSG_NOTIFY chatId=" + chatId + " call_ui_active=true lower_priority=true");
    }

    String senderName = firstNonEmpty(data.get("senderName"), data.get("sender_name"), "Message");
    String text = firstNonEmpty(data.get("text"), data.get("body"), "");
    String senderId = firstNonEmpty(data.get("senderId"), data.get("sender_id"), "");
    String avatarUrl = firstNonEmpty(data.get("avatar"), data.get("senderAvatar"), data.get("sender_avatar"));
    long when = parseLongMs(firstNonEmpty(data.get("sentAt"), data.get("timestamp"), ""));
    if (when <= 0) when = System.currentTimeMillis();

    int unreadInChat = incrementUnread(app, chatId);
    String unreadCountStr = data.get("unreadCount");
    if (unreadCountStr != null && !unreadCountStr.isEmpty()) {
      try {
        unreadInChat = Math.max(unreadInChat, Integer.parseInt(unreadCountStr));
      } catch (NumberFormatException ignored) {
      }
    }
    int unreadTotal =
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("chat_unread_total", -1);

    ensureChannels(app);

    String channel = callActive ? CHANNEL_ID_QUIET : CHANNEL_ID;
    String pkg = app.getPackageName();
    String preview = trimPreview(text);

    Person senderPerson =
        new Person.Builder()
            .setName(senderName)
            .setKey(senderId.isEmpty() ? senderName : senderId)
            .setImportant(true)
            .build();

    Person self = new Person.Builder().setName(" ").setKey("local_self").build();

    NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(self);
    style.setGroupConversation(false);
    if (unreadTotal > 0) {
      style.setConversationTitle(senderName + " · " + unreadTotal + " unread");
    } else if (unreadInChat > 1) {
      style.setConversationTitle(senderName + " (" + unreadInChat + ")");
      Log.d(TAG, "MSG_NOTIFY grouped chatId=" + chatId + " count=" + unreadInChat);
    }
    style.addMessage(preview, when, senderPerson);

    Intent open = chatDeepLinkIntent(pkg, chatId, false, false);
    PendingIntent openPi =
        GywIncomingCallNotifier.activityPendingIntent(
            app, notifRequestCode(chatId, 1), open);

    Intent markRead = new Intent(app, GywMessageNotificationActionReceiver.class);
    markRead.setAction(GywMessageNotificationActionReceiver.ACTION_MARK_READ);
    markRead.setPackage(pkg);
    markRead.putExtra(GywMessageNotificationActionReceiver.EXTRA_CHAT_ID, chatId);
    int immutable = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    PendingIntent markReadPi =
        PendingIntent.getBroadcast(app, notifRequestCode(chatId, 2), markRead, immutable);

    Intent replyIntent = new Intent(app, GywMessageNotificationActionReceiver.class);
    replyIntent.setAction(GywMessageNotificationActionReceiver.ACTION_REPLY);
    replyIntent.setPackage(pkg);
    replyIntent.putExtra(GywMessageNotificationActionReceiver.EXTRA_CHAT_ID, chatId);
    replyIntent.putExtra(GywMessageNotificationActionReceiver.EXTRA_SENDER_ID, senderId);
    RemoteInput remoteInput =
        new RemoteInput.Builder(KEY_TEXT_REPLY).setLabel("Reply").build();
    int replyFlags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      replyFlags |= PendingIntent.FLAG_MUTABLE;
    } else {
      replyFlags |= PendingIntent.FLAG_IMMUTABLE;
    }
    PendingIntent replyPi =
        PendingIntent.getBroadcast(app, notifRequestCode(chatId, 3), replyIntent, replyFlags);

    NotificationCompat.Action replyAction =
        new NotificationCompat.Action.Builder(
                android.R.drawable.sym_action_chat, "Reply", replyPi)
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(false)
            .build();

    NotificationCompat.Action readAction =
        new NotificationCompat.Action.Builder(
                android.R.drawable.checkbox_on_background, "Mark read", markReadPi)
            .build();

    int smallIcon = app.getApplicationInfo().icon;
    if (smallIcon == 0) {
      smallIcon = android.R.drawable.stat_notify_chat;
    }

    Bitmap largeIcon = null;
    if (!TextUtils.isEmpty(avatarUrl)) {
      largeIcon = downloadBitmapSmall(avatarUrl);
    }
    if (largeIcon == null) {
      largeIcon = letterBitmap(app, senderName);
    }

    NotificationCompat.Builder b =
        new NotificationCompat.Builder(app, channel)
            .setSmallIcon(smallIcon)
            .setLargeIcon(largeIcon)
            .setStyle(style)
            .setContentTitle(senderName)
            .setContentText(preview)
            .setWhen(when)
            .setShowWhen(true)
            .setAutoCancel(true)
            .setOnlyAlertOnce(unreadInChat > 1)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setGroup(GROUP_KEY_CHATS)
            .setGroupSummary(false)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setContentIntent(openPi)
            .setNumber(unreadInChat)
            .setPriority(
                callActive ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
            .addAction(replyAction)
            .addAction(readAction);

    NotificationManager nm =
        (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        if (ContextCompat.checkSelfPermission(app, android.Manifest.permission.POST_NOTIFICATIONS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
          Log.w(TAG, "MSG_NOTIFY chatId=" + chatId + " shown=false reason=no_post_notifications");
          return;
        }
      }
      nm.notify(notifTag(chatId), notifId(chatId), b.build());
      Log.d(TAG, "MSG_NOTIFY_SHOWN chatId=" + chatId);
      Log.d(
          TAG,
          "MSG_NOTIFY chatId="
              + chatId
              + " shown=true messageId="
              + messageId
              + " unread_in_chat="
              + unreadInChat);
      postGroupSummary(app, nm);
    } catch (Exception e) {
      Log.e(TAG, "MSG_NOTIFY post failed: " + e.getMessage());
    }
  }

  private static void postGroupSummary(Context app, NotificationManager nm) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
    try {
      int count = countActiveChatThreads(nm);
      if (count < 2) {
        nm.cancel("gyw_chat_summary", SUMMARY_ID);
        return;
      }
      String pkg = app.getPackageName();
      Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("gyw:///(home)/(tabs)/chats"));
      open.setClassName(pkg, pkg + ".MainActivity");
      open.addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK
              | Intent.FLAG_ACTIVITY_CLEAR_TOP
              | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      PendingIntent pi =
          GywIncomingCallNotifier.activityPendingIntent(app, SUMMARY_PI_REQ, open);
      int smallIcon = app.getApplicationInfo().icon;
      if (smallIcon == 0) smallIcon = android.R.drawable.stat_notify_chat;
      String channel = GywIncomingCallNotifier.hasActiveIncomingCallUi(app)
          ? CHANNEL_ID_QUIET
          : CHANNEL_ID;
      Notification summary =
          new NotificationCompat.Builder(app, channel)
              .setSmallIcon(smallIcon)
              .setContentTitle("Messages")
              .setContentText(count + " conversations")
              .setStyle(
                  new NotificationCompat.InboxStyle()
                      .setBigContentTitle("New messages")
                      .addLine(count + " active chats"))
              .setGroup(GROUP_KEY_CHATS)
              .setGroupSummary(true)
              .setAutoCancel(true)
              .setCategory(Notification.CATEGORY_STATUS)
              .setContentIntent(pi)
              .build();
      nm.notify("gyw_chat_summary", SUMMARY_ID, summary);
      Log.d(TAG, "MSG_NOTIFY grouped summary count=" + count);
    } catch (Exception e) {
      Log.w(TAG, "MSG_NOTIFY summary err=" + e.getMessage());
    }
  }

  private static int countActiveChatThreads(NotificationManager nm) {
    int n = 0;
    try {
      for (android.service.notification.StatusBarNotification sbn : nm.getActiveNotifications()) {
        if (sbn == null) continue;
        String tag = sbn.getTag();
        if (tag != null && tag.startsWith("gyw_chat_") && !tag.equals("gyw_chat_summary")) {
          n++;
        }
      }
    } catch (Exception ignored) {
    }
    return n;
  }

  static void storePendingReply(Context app, String chatId, String senderId, String body) {
    String json =
        "{\"chatId\":\""
            + escapeJson(chatId)
            + "\",\"senderId\":\""
            + escapeJson(senderId)
            + "\",\"body\":\""
            + escapeJson(body)
            + "\",\"ts\":"
            + System.currentTimeMillis()
            + "}";
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_PENDING_REPLY, json)
        .apply();
  }

  @Nullable
  public static String consumePendingReplyJson(Context app) {
    android.content.SharedPreferences p =
        app.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String v = p.getString(PREF_PENDING_REPLY, null);
    if (v != null) {
      p.edit().remove(PREF_PENDING_REPLY).apply();
    }
    return v;
  }

  private static String escapeJson(String s) {
    if (s == null) return "";
    return s.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static boolean wasRecentlyShown(Context app, String messageId) {
    android.content.SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    Set<String> ids = new HashSet<>(p.getStringSet(PREF_DEDUPE, new HashSet<>()));
    if (ids.contains(messageId)) {
      return true;
    }
    ids.add(messageId);
    while (ids.size() > 200) {
      ids.remove(ids.iterator().next());
    }
    p.edit().putStringSet(PREF_DEDUPE, ids).apply();
    return false;
  }

  private static int incrementUnread(Context app, String chatId) {
    android.content.SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String key = PREF_UNREAD_PREFIX + chatId;
    int v = p.getInt(key, 0) + 1;
    p.edit().putInt(key, v).apply();
    return v;
  }

  private static void resetUnread(Context app, String chatId) {
    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt(PREF_UNREAD_PREFIX + chatId, 0)
        .apply();
  }

  private static void ensureChannels(Context app) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = app.getSystemService(NotificationManager.class);
    if (nm == null) return;

    Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    AudioAttributes attrs =
        new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

    NotificationChannel high =
        new NotificationChannel(
            CHANNEL_ID, "Chat messages", NotificationManager.IMPORTANCE_HIGH);
    high.setDescription("New chat messages");
    high.setSound(sound, attrs);
    high.enableVibration(true);
    high.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
    nm.createNotificationChannel(high);

    NotificationChannel quiet =
        new NotificationChannel(
            CHANNEL_ID_QUIET, "Chat messages (during calls)", NotificationManager.IMPORTANCE_LOW);
    quiet.setDescription("Lower interruption while a call is ringing or active");
    quiet.setSound(null, null);
    quiet.enableVibration(false);
    quiet.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
    nm.createNotificationChannel(quiet);
  }

  static Intent chatDeepLinkIntent(String pkg, String chatId, boolean markRead, boolean fromReply) {
    String path = Uri.encode(chatId);
    String uri =
        "gyw://chat/"
            + path
            + "?fromNotif=1"
            + (markRead ? "&markRead=1" : "")
            + (fromReply ? "&fromReply=1" : "");
    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
    intent.setClassName(pkg, pkg + ".MainActivity");
    intent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    return intent;
  }

  private static String notifTag(String chatId) {
    return "gyw_chat_" + chatId;
  }

  private static int notifId(String chatId) {
    return NOTIF_ID_BASE + (Math.abs(chatId.hashCode()) % 0x0000_FFFF);
  }

  private static int notifRequestCode(String chatId, int salt) {
    return Math.abs(("msg_pi_" + chatId + "_" + salt).hashCode());
  }

  private static String nz(@Nullable String s) {
    return s == null ? "" : s;
  }

  private static String firstNonEmpty(@Nullable String a, @Nullable String b, String fallback) {
    if (a != null && !a.isEmpty()) return a;
    if (b != null && !b.isEmpty()) return b;
    return fallback;
  }

  private static long parseLongMs(String s) {
    try {
      if (s.isEmpty()) return 0L;
      return Long.parseLong(s);
    } catch (Exception e) {
      return 0L;
    }
  }

  private static String trimPreview(String t) {
    if (t == null) return "";
    String x = t.trim();
    if (x.length() > 240) return x.substring(0, 237) + "…";
    return x;
  }

  @Nullable
  private static Bitmap letterBitmap(Context ctx, String name) {
    try {
      String letter =
          name == null || name.isEmpty()
              ? "?"
              : name.trim().substring(0, 1).toUpperCase(Locale.US);
      int size = (int) (48 * ctx.getResources().getDisplayMetrics().density);
      Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
      Canvas c = new Canvas(bmp);
      Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
      p.setColor(Color.parseColor("#2563EB"));
      c.drawCircle(size / 2f, size / 2f, size / 2f, p);
      p.setColor(Color.WHITE);
      p.setTextSize(size * 0.45f);
      p.setTypeface(Typeface.DEFAULT_BOLD);
      Rect bounds = new Rect();
      p.getTextBounds(letter, 0, letter.length(), bounds);
      float x = size / 2f - bounds.exactCenterX();
      float y = size / 2f - bounds.exactCenterY();
      c.drawText(letter, x, y, p);
      return bmp;
    } catch (Exception e) {
      return null;
    }
  }

  @Nullable
  private static Bitmap downloadBitmapSmall(String urlStr) {
    HttpURLConnection c = null;
    InputStream in = null;
    try {
      URL url = new URL(urlStr);
      c = (HttpURLConnection) url.openConnection();
      c.setConnectTimeout(2000);
      c.setReadTimeout(2500);
      c.connect();
      in = c.getInputStream();
      Bitmap raw = BitmapFactory.decodeStream(in);
      if (raw == null) return null;
      int max = 256;
      float scale = Math.min((float) max / raw.getWidth(), (float) max / raw.getHeight());
      if (scale >= 1f) return raw;
      int w = Math.max(1, (int) (raw.getWidth() * scale));
      int h = Math.max(1, (int) (raw.getHeight() * scale));
      return Bitmap.createScaledBitmap(raw, w, h, true);
    } catch (Exception e) {
      return null;
    } finally {
      try {
        if (in != null) in.close();
      } catch (Exception ignored) {
      }
      if (c != null) c.disconnect();
    }
  }
}
