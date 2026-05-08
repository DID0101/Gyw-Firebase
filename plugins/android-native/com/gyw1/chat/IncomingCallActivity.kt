package com.gyw1.chat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.app.KeyguardManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class IncomingCallActivity : AppCompatActivity() {
  private val tag = "IncomingCallActivity"

  // Ringtone/vibration is managed by GywIncomingCallAlerts (started earlier by
  // GywFirebaseMessagingService and GywIncomingCallService).  The activity no
  // longer owns a separate Ringtone instance to prevent double-ringing.
  private val timeoutHandler = Handler(Looper.getMainLooper())
  private var timeoutRunnable: Runnable? = null

  private val finishReceiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          cancelTimeout()
          finish()
        }
      }

  private var callerName: String = "Unknown caller"
  private var callerAvatar: String = ""
  private var callType: String = "audio"
  private var chatId: String = ""
  private var actionInFlight: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Log.d(tag, "onCreate")

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      km?.requestDismissKeyguard(this, null)
    }

    @Suppress("DEPRECATION")
    window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    readIntentData(intent)
    if (chatId.isNotBlank()) {
      Log.d(tag, "INCOMING_TRIGGER source=activity_launch callId=$chatId ts=${System.currentTimeMillis()}")
    }
    setContentView(buildContent())

    // Ringtone/vibration: managed by GywIncomingCallAlerts (already started by
    // GywFirebaseMessagingService → GywIncomingCallService before this activity).
    scheduleTimeout()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    Log.d(tag, "onNewIntent")
    setIntent(intent)
    readIntentData(intent)
    if (chatId.isNotBlank()) {
      Log.d(tag, "INCOMING_TRIGGER source=activity_launch callId=$chatId ts=${System.currentTimeMillis()}")
    }
    setContentView(buildContent())
    cancelTimeout()
    scheduleTimeout()
  }

  override fun onStart() {
    super.onStart()
    val filter = IntentFilter(ACTION_FINISH_INCOMING_UI)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(finishReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(finishReceiver, filter)
    }
  }

  override fun onStop() {
    try {
      unregisterReceiver(finishReceiver)
    } catch (_: Exception) {
    }
    super.onStop()
  }

  override fun onDestroy() {
    cancelTimeout()
    super.onDestroy()
  }

  private fun readIntentData(intent: Intent?) {
    val safeIntent = intent ?: return
    callerName = safeIntent.getStringExtra(EXTRA_CALLER_NAME)?.takeIf { it.isNotBlank() } ?: "Incoming call"
    callerAvatar = safeIntent.getStringExtra(EXTRA_CALLER_AVATAR) ?: ""
    callType = safeIntent.getStringExtra(EXTRA_CALL_TYPE)?.lowercase()?.let {
      if (it == "video") "video" else "audio"
    } ?: "audio"

    val incomingChatId = safeIntent.getStringExtra(EXTRA_CHAT_ID)
    val fallbackCallId = safeIntent.getStringExtra(EXTRA_CALL_ID)
    chatId = when {
      !incomingChatId.isNullOrBlank() -> incomingChatId
      !fallbackCallId.isNullOrBlank() -> fallbackCallId
      else -> ""
    }
  }

  private fun buildContent(): View {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setBackgroundColor(Color.parseColor("#101010"))
      val pad = dp(24)
      setPadding(pad, pad, pad, pad)
    }

    val title = TextView(this).apply {
      text = if (callType == "video") "Incoming Video Call" else "Incoming Audio Call"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      gravity = Gravity.CENTER
    }
    root.addView(title, matchWrap())

    val avatar = TextView(this).apply {
      text = callerName.trim().take(1).uppercase()
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#2B2B2B"))
      val p = dp(16)
      setPadding(p, p, p, p)
      minWidth = dp(72)
      minHeight = dp(72)
    }
    root.addView(avatar, matchWrap(topMargin = 16))

    if (callerAvatar.isNotBlank()) {
      val avatarHint = TextView(this).apply {
        text = "Avatar available"
        setTextColor(Color.parseColor("#8A8A8A"))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        gravity = Gravity.CENTER
      }
      root.addView(avatarHint, matchWrap(topMargin = 6))
    }

    val nameTv = TextView(this).apply {
      text = callerName
      setTextColor(Color.parseColor("#EAEAEA"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
      gravity = Gravity.CENTER
    }
    root.addView(nameTv, matchWrap(topMargin = 12))

    val typeTv = TextView(this).apply {
      text = if (callType == "video") "Video" else "Audio"
      setTextColor(Color.parseColor("#B6B6B6"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
      gravity = Gravity.CENTER
    }
    root.addView(typeTv, matchWrap(topMargin = 8))

    val actionsRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    root.addView(actionsRow, matchWrap(topMargin = 36))

    val declineButton = Button(this).apply {
      text = "Decline"
      setBackgroundColor(Color.parseColor("#D92D20"))
      setTextColor(Color.WHITE)
      setOnClickListener { declineCall() }
    }
    actionsRow.addView(declineButton, weightedButton(endMargin = 8))

    val acceptButton = Button(this).apply {
      text = "Accept"
      setBackgroundColor(Color.parseColor("#16A34A"))
      setTextColor(Color.WHITE)
      setOnClickListener { acceptCall() }
    }
    actionsRow.addView(acceptButton, weightedButton(startMargin = 8))

    return root
  }

  private fun stopCallService() {
    try {
      val stopIntent = Intent(this, GywIncomingCallService::class.java).apply {
        action = GywIncomingCallService.ACTION_STOP
      }
      startService(stopIntent)
    } catch (e: Exception) {
      Log.w(tag, "stopCallService failed: ${e.message}")
    }
  }

  private fun acceptCall() {
    if (actionInFlight) return
    actionInFlight = true
    Log.d(tag, "acceptCall chatId=$chatId callType=$callType")
    cancelTimeout()
    stopCallService()
    IncomingCallGuard.release(this, chatId, "accepted")
    IncomingCallActionHandler.accept(this, chatId, callType, "activity", true)
    finish()
  }

  private fun declineCall() {
    if (actionInFlight) return
    actionInFlight = true
    Log.d(tag, "declineCall chatId=$chatId callType=$callType")
    cancelTimeout()
    stopCallService()
    IncomingCallGuard.release(this, chatId, "declined")
    // Launch RN call screen with decline=1 so JS can update Firestore terminal state
    // even when decline happens outside the app process.
    IncomingCallActionHandler.decline(this, chatId, callType, "activity", true)
    finish()
  }

  private fun scheduleTimeout() {
    Log.d(tag, "scheduleTimeout 30000ms")
    timeoutRunnable = Runnable {
      IncomingCallGuard.release(this, chatId, "timeout")
      IncomingCallActionHandler.releaseTerminalLock(chatId, "timeout")
      finish()
    }
    timeoutHandler.postDelayed(timeoutRunnable!!, TIMEOUT_MS)
  }

  private fun cancelTimeout() {
    timeoutRunnable?.let(timeoutHandler::removeCallbacks)
    timeoutRunnable = null
  }

  private fun matchWrap(topMargin: Int = 0): LinearLayout.LayoutParams {
    return LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT)
        .apply { this.topMargin = dp(topMargin) }
  }

  private fun weightedButton(startMargin: Int = 0, endMargin: Int = 0): LinearLayout.LayoutParams {
    return LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
      marginStart = dp(startMargin)
      marginEnd = dp(endMargin)
    }
  }

  private fun dp(value: Int): Int {
    return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics)
        .toInt()
  }

  companion object {
    const val ACTION_FINISH_INCOMING_UI = "com.gyw1.chat.action.FINISH_INCOMING_ACTIVITY"
    const val ACTION_INCOMING_CALL_DECLINED = "com.gyw1.chat.action.INCOMING_CALL_DECLINED"

    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_CALLER_AVATAR = "callerAvatar"
    const val EXTRA_CALL_TYPE = "callType"
    const val EXTRA_CHAT_ID = "chatId"
    const val EXTRA_ACCEPTED = "accepted"

    private const val TIMEOUT_MS = 30_000L

    @JvmStatic
    fun buildShowIntent(
        context: Context,
        callId: String,
        callerName: String?,
        callerAvatar: String?,
        callType: String?
    ): Intent {
      return Intent(context, IncomingCallActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_CHAT_ID, callId)
        putExtra(EXTRA_CALLER_NAME, callerName ?: "Incoming call")
        putExtra(EXTRA_CALLER_AVATAR, callerAvatar ?: "")
        putExtra(EXTRA_CALL_TYPE, callType ?: "audio")
      }
    }
  }
}
