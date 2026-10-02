package com.gyw1.chat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Posts the incoming-call notification with a full-screen intent (required for lock screen /
 * killed state) and attempts a direct [IncomingCallActivity] launch when allowed.
 */
object IncomingCallFcmHandler {
  private const val TAG = "IncomingCallFcmHandler"

  /** Fresh channel id — Android permanently caches channel importance per install. */
  const val CALL_CHANNEL_ID = "incoming_calls_v3"

  const val ACTION_ACCEPT_CALL = "ACTION_ACCEPT_CALL"
  const val ACTION_DECLINE_CALL = "ACTION_DECLINE_CALL"

  fun presentIncomingCall(
      context: Context,
      callId: String,
      callerName: String,
      callerAvatar: String,
      callType: String,
  ) {
    if (!IncomingCallPathConfig.mayPostIncomingNotification(context)) {
      return
    }
    val ctx = context.applicationContext
    val normalizedType = GywIncomingCallNotifier.normalizeCallType(callType)
    val title = callerName.ifBlank { "Incoming call" }
    GywIncomingCallNotifier.postPremiumIncomingCallNotification(
        ctx,
        callId,
        title,
        callerAvatar,
        normalizedType,
    )

    if (IncomingCallProcessState.shouldLaunchFromFcmImmediately(ctx)) {
      Log.w(TAG, "FULLSCREEN_ATTEMPTED=true source=fcm_present callId=$callId")
      val launched =
          IncomingCallUiLauncher.launchDirect(
              ctx,
              callId,
              title,
              callerAvatar,
              normalizedType,
              "fcm_present",
          )
      IncomingCallUiLauncher.logFullscreenAttemptResult(ctx, callId, launched, 500L)
      if (launched) {
        GywIncomingCallNotifier.rememberActiveCallIdPublic(ctx, callId)
        Log.d(TAG, "presentIncomingCall activity+notification callId=$callId")
        return
      }
    }

    Log.d(TAG, "presentIncomingCall notification backup (telecom/FGS will attempt fullscreen) callId=$callId")
  }

  private fun ensureCallNotificationChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val existing = nm.getNotificationChannel(CALL_CHANNEL_ID)
    if (existing != null && existing.importance >= NotificationManager.IMPORTANCE_HIGH) {
      Log.d(TAG, "channel importance: ${existing.importance}")
      return
    }

    if (existing != null) {
      Log.w(
          TAG,
          "Deleting low-importance channel $CALL_CHANNEL_ID importance=${existing.importance}",
      )
      nm.deleteNotificationChannel(CALL_CHANNEL_ID)
    }

    val channel =
        NotificationChannel(
            CALL_CHANNEL_ID,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH,
        )
            .apply {
              description = "Incoming call alerts"
              lockscreenVisibility = Notification.VISIBILITY_PUBLIC
              setBypassDnd(true)
              enableVibration(true)
              vibrationPattern = longArrayOf(0, 500, 200, 500)
              setShowBadge(false)
              setSound(null, null)
            }
    nm.createNotificationChannel(channel)
    Log.d(TAG, "created channel $CALL_CHANNEL_ID importance=HIGH (${NotificationManager.IMPORTANCE_HIGH})")
  }
}
