package com.gyw1.chat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Decline action from the incoming-call notification (full-screen / heads-up).
 */
class IncomingCallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != IncomingCallFcmHandler.ACTION_DECLINE_CALL) return
    val callId =
        intent.getStringExtra(IncomingCallActivity.EXTRA_CALL_ID)
            ?: intent.getStringExtra(IncomingCallActivity.EXTRA_CHAT_ID)
            ?: return

    Log.d(TAG, "decline from notification callId=$callId")
    GywIncomingCallNotifier.stopRingingAndDismissUi(context.applicationContext, callId)
    IncomingCallActionHandler.decline(context, callId, "audio", "notification_receiver", false)
  }

  companion object {
    private const val TAG = "IncomingCallReceiver"
  }
}
