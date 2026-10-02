package com.gyw1.chat

import android.animation.ValueAnimator
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.app.KeyguardManager
import android.os.PowerManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class IncomingCallActivity : AppCompatActivity() {
  private val tag = "IncomingCallActivity"

  /** Set true to show minimal native test UI (no RN). Flip off for production UI. */
  private val lockscreenDebugNativeUi: Boolean = false

  @Volatile
  private var uiVisible: Boolean = false
  @Volatile
  private var hasWindowFocusState: Boolean = false
  @Volatile
  private var activityOnCreateLogged: Boolean = false
  @Volatile
  private var activityOnResumeLogged: Boolean = false

  private val timeoutHandler = Handler(Looper.getMainLooper())
  private val diagHandler = Handler(Looper.getMainLooper())
  private var timeoutRunnable: Runnable? = null
  private var avatarPulseAnimator: ValueAnimator? = null

  private val finishReceiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          val finishCallId =
              intent?.getStringExtra(EXTRA_CALL_ID) ?: intent?.getStringExtra(EXTRA_CHAT_ID)
          if (!finishCallId.isNullOrBlank() && chatId.isNotBlank() && finishCallId != chatId) {
            Log.d(tag, "FINISH_BROADCAST_IGNORED expected=$chatId got=$finishCallId")
            return
          }
          Log.d(tag, "FINISH_BROADCAST_APPLIED callId=$chatId")
          cancelTimeout()
          finishWithReason("finish_broadcast")
        }
      }

  private var callerName: String = "Unknown Caller"
  private var callerSubtitle: String = ""
  private var callerPhone: String = ""
  private var callerAvatar: String = ""
  private var callType: String = "audio"
  private var chatId: String = ""
  private var callerUid: String = ""
  private var actionInFlight: Boolean = false
  private var acceptButton: View? = null
  private var declineButton: View? = null
  private var rootContentView: View? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    uiVisible = true

    readIntentData(intent)
    activityOnCreateLogged = true
    logActivityLifecycle("onCreate")

    if (chatId.isBlank()) {
      Log.w(tag, "onCreate: missing callId")
      finishWithReason("missing_call_id")
      return
    }

    // Phase 5: ALL lockscreen APIs BEFORE setContentView.
    applyLockscreenBeforeContent(beforeContent = true)

    // Phase 2: pure native UI only (optional debug layout — never touches RN).
    val content =
        if (lockscreenDebugNativeUi) buildLockscreenDebugUi() else buildContent()
    setContentView(content)
    rootContentView = content
    playEnterAnimation(content)
    instance = this
    Log.d(tag, "btn_accept found: ${acceptButton != null}")
    Log.d(tag, "btn_decline found: ${declineButton != null}")

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.let { controller ->
        controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
        controller.systemBarsBehavior =
            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    }

    if (chatId.isNotBlank()) {
      Log.d(tag, "INCOMING_TRIGGER source=activity_launch callId=$chatId ts=${System.currentTimeMillis()}")
      Log.d(tag, "DIRECT_ACTIVITY_LAUNCH_SUCCESS callId=$chatId")
    }

    if (intent?.action == IncomingCallFcmHandler.ACTION_ACCEPT_CALL) {
      acceptButton?.post { acceptCall() } ?: acceptCall()
      return
    }

    scheduleTimeout()
    scheduleOemBlockingProbe()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    readIntentData(intent)
    logActivityLifecycle("onNewIntent")
    if (chatId.isNotBlank()) {
      Log.d(tag, "INCOMING_TRIGGER source=activity_launch callId=$chatId ts=${System.currentTimeMillis()}")
    }
    applyLockscreenBeforeContent(beforeContent = false)
    stopAvatarPulse()
    val content =
        if (lockscreenDebugNativeUi) buildLockscreenDebugUi() else buildContent()
    setContentView(content)
    rootContentView = content
    playEnterAnimation(content)
    cancelTimeout()
    scheduleTimeout()
  }

  override fun onResume() {
    super.onResume()
    uiVisible = true
    activityOnResumeLogged = true
    applyLockscreenBeforeContent(beforeContent = false)
    logActivityLifecycle("onResume")
    if (chatId.isNotBlank()) {
      CallLatencyTrace.mark(chatId, "INCOMING_UI_VISIBLE")
    }
  }

  override fun onPostResume() {
    super.onPostResume()
    logActivityLifecycle("onPostResume")
    emitFinalVisibilityVerdict()
  }

  override fun onPause() {
    uiVisible = false
    logActivityLifecycle("onPause")
    super.onPause()
  }

  override fun onStart() {
    super.onStart()
    logActivityLifecycle("onStart")
    val filter =
        IntentFilter().apply {
          addAction(ACTION_FINISH_INCOMING_UI)
          addAction(IncomingCallModule.ACTION_DISMISS_INCOMING_CALL)
        }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(finishReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(finishReceiver, filter)
    }
  }

  override fun onStop() {
    logActivityLifecycle("onStop")
    try {
      unregisterReceiver(finishReceiver)
    } catch (_: Exception) {
    }
    super.onStop()
  }

  override fun onDestroy() {
    uiVisible = false
    if (instance === this) instance = null
    logActivityLifecycle("onDestroy")
    cancelTimeout()
    stopAvatarPulse()
    acceptGlowAnimator?.cancel()
    acceptGlowAnimator = null
    super.onDestroy()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    hasWindowFocusState = hasFocus
    Log.w(tag, "ACTIVITY_WINDOW_FOCUS=$hasFocus callId=$chatId taskId=$taskId")
    IncomingCallDiagnostics.logTopActivity(this, tag, IncomingCallActivity::class.java.name)
  }

  /** Phase 5 — lockscreen window must be configured before any content is inflated. */
  private fun applyLockscreenBeforeContent(beforeContent: Boolean = false) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        setInheritShowWhenLocked(true)
      }
    }

    @Suppress("DEPRECATION")
    window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
    )
    if (beforeContent) {
      Log.w(tag, "WINDOW_FLAGS_APPLIED_BEFORE_CONTENT=true callId=$chatId")
    } else {
      Log.d(tag, "LOCKSCREEN_FLAGS_REAPPLIED callId=$chatId")
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      val locked = km?.isKeyguardLocked == true
      Log.d(tag, "KEYGUARD_DISMISS_REQUESTED locked=$locked callId=$chatId")
      km?.requestDismissKeyguard(
          this,
          object : KeyguardManager.KeyguardDismissCallback() {
            override fun onDismissSucceeded() {
              Log.d(tag, "LOCKSCREEN_DISMISS_SUCCEEDED callId=$chatId")
            }

            override fun onDismissError() {
              Log.w(tag, "LOCKSCREEN_DISMISS_ERROR callId=$chatId")
            }
          })
    }
  }

  private fun finishWithReason(reason: String) {
    Log.d(tag, "AUTO_CLOSE_REASON=$reason callId=$chatId isFinishing=$isFinishing")
    if (!isFinishing) {
      finish()
    }
  }

  /** Phase 2/3 — lifecycle + lockscreen + top-activity evidence. */
  private fun logActivityLifecycle(event: String) {
    val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
    val keyguardLocked = km?.isKeyguardLocked == true
    val deviceLocked =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          km?.isDeviceLocked == true
        } else {
          keyguardLocked
        }
    val interactive = pm?.isInteractive == true
    val windowVisible = window?.decorView?.visibility == View.VISIBLE

    Log.w(tag, "ACTIVITY_$event callId=$chatId taskId=$taskId")
    Log.w(
        tag,
        "ACTIVITY_$event KeyguardManager.isKeyguardLocked=$keyguardLocked " +
            "isDeviceLocked=$deviceLocked PowerManager.isInteractive=$interactive " +
            "windowVisible=$windowVisible isFinishing=$isFinishing",
    )
    Log.w(tag, "ACTIVITY_WINDOW_FOCUS=$hasWindowFocusState")
    IncomingCallDiagnostics.logTopActivity(this, tag, IncomingCallActivity::class.java.name)

    if (event == "onCreate" && !activityOnResumeLogged && (deviceLocked || !interactive)) {
      Log.w(tag, "OEM_BLOCKING_FULLSCREEN_WINDOW=pending_probe callId=$chatId")
    }
    if (event == "onCreate" || event == "onResume") {
      IncomingCallPathConfig.logActiveMode(tag)
      IncomingCallPathConfig.logPhoneAccountAudit(this, tag)
    }
  }

  /** Phase 3 — if onCreate ran but no focus after delay, OEM is hiding the window. */
  private fun scheduleOemBlockingProbe() {
    diagHandler.postDelayed(
        {
          if (isFinishing || isDestroyed) return@postDelayed
          if (activityOnCreateLogged && !activityOnResumeLogged) {
            Log.e(tag, "OEM_BLOCKING_FULLSCREEN_WINDOW=true reason=onCreate_without_onResume")
          } else if (activityOnResumeLogged && !hasWindowFocusState) {
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            val locked =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                  km?.isDeviceLocked == true
                } else {
                  km?.isKeyguardLocked == true
                }
            if (locked) {
              Log.e(tag, "OEM_BLOCKING_FULLSCREEN_WINDOW=true reason=onResume_no_window_focus")
            }
          }
        },
        900L,
    )
  }

  private fun emitFinalVisibilityVerdict() {
    val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    val deviceLocked =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          km?.isDeviceLocked == true
        } else {
          km?.isKeyguardLocked == true
        }
    IncomingCallDiagnostics.emitVisibilityVerdict(
        tag,
        GywCallConnection.onShowIncomingCallUiFired,
        activityOnCreateLogged,
        activityOnResumeLogged,
        hasWindowFocusState,
        deviceLocked,
    )
  }

  /** Phase 2 — minimal native-only test surface (toggle lockscreenDebugNativeUi). */
  private fun buildLockscreenDebugUi(): View {
    val root =
        FrameLayout(this).apply {
          setBackgroundColor(Color.parseColor("#B71C1C"))
          layoutParams =
              FrameLayout.LayoutParams(
                  FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
    val label =
        TextView(this).apply {
          text = "LOCKSCREEN NATIVE TEST\n$callerName\n$callType\n$chatId"
          setTextColor(Color.WHITE)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
          gravity = Gravity.CENTER
          typeface = Typeface.DEFAULT_BOLD
        }
    root.addView(
        label,
        FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER))
    val actions = buildPremiumActionRow(callType == "video", IncomingCallUiTheme.accent(callType == "video"))
    root.addView(
        actions,
        FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM)
            .apply { bottomMargin = dp(48) })
    return root
  }

  private fun applyLockscreenWindowFlags() {
    applyLockscreenBeforeContent()
  }

  private fun logLifecycle(event: String) {
    logActivityLifecycle(event)
  }

  private fun readIntentData(intent: Intent?) {
    val safeIntent = intent ?: return
    val meta = IncomingCallMetadata.resolveFromIntent(safeIntent)
    callerName = meta.callerName
    callerAvatar = meta.callerAvatar
    callerPhone = meta.callerPhone
    callType = meta.callType
    chatId = meta.callId.takeIf { it != "unknown" } ?: ""
    callerUid = meta.callerUid
    callerSubtitle = buildCallerSubtitle(meta)
    Log.w(
        tag,
        "CALLER_META_RENDERED callId=$chatId callerName=$callerName callerAvatar=$callerAvatar callerUid=$callerUid callType=$callType",
    )
  }

  private fun buildCallerSubtitle(meta: IncomingCallMetadata.Resolved): String {
    val phone = meta.callerPhone.trim()
    val name = meta.callerName.trim()
    if (phone.isNotEmpty() && !phone.equals(name, ignoreCase = true)) return phone
    return ""
  }

  private fun buildContent(): View {
    val isVideo = callType == "video"
    return buildPremiumIncomingUi(isVideo)
  }

  private fun buildPremiumIncomingUi(isVideo: Boolean): FrameLayout {
    val accent = IncomingCallUiTheme.accent(isVideo)
    val shell =
        FrameLayout(this).apply {
          layoutParams =
              FrameLayout.LayoutParams(
                  FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
          background =
              GradientDrawable(
                  GradientDrawable.Orientation.TOP_BOTTOM,
                  intArrayOf(
                      Color.parseColor(IncomingCallUiTheme.BG_TOP),
                      Color.parseColor(IncomingCallUiTheme.BG_BOTTOM),
                  ),
              )
        }

    val column =
        LinearLayout(this).apply {
          orientation = LinearLayout.VERTICAL
          gravity = Gravity.CENTER_HORIZONTAL
          layoutParams =
              FrameLayout.LayoutParams(
                  FrameLayout.LayoutParams.MATCH_PARENT,
                  FrameLayout.LayoutParams.MATCH_PARENT)
          val topInset = statusBarInsetPx() + dp(20)
          setPadding(dp(28), topInset, dp(28), dp(36))
        }
    shell.addView(column)

    column.addView(buildTopHeader(isVideo, accent))
    column.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 0, 1f) })

    val center =
        LinearLayout(this).apply {
          orientation = LinearLayout.VERTICAL
          gravity = Gravity.CENTER_HORIZONTAL
        }
    center.addView(buildAvatarView(isVideo, accent))
    center.addView(buildCallerNameView())
    if (callerSubtitle.isNotBlank()) {
      center.addView(buildCallerSubtitleView())
    }
    center.addView(buildIncomingTypeLabel(isVideo, accent))
    column.addView(
        center,
        LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    column.addView(buildPremiumActionRow(isVideo, accent))
    return shell
  }

  private fun statusBarInsetPx(): Int {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
      if (resId > 0) return resources.getDimensionPixelSize(resId)
    }
    return dp(24)
  }

  private fun buildTopHeader(isVideo: Boolean, accent: Int): LinearLayout {
    val row =
        LinearLayout(this).apply {
          orientation = LinearLayout.VERTICAL
          gravity = Gravity.CENTER_HORIZONTAL
        }
    row.addView(
        TextView(this).apply {
          text = "End-to-end encrypted"
          setTextColor(Color.parseColor(IncomingCallUiTheme.ENCRYPTED))
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
          letterSpacing = 0.02f
          gravity = Gravity.CENTER
        })
    val typeRow =
        LinearLayout(this).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER
          setPadding(0, dp(10), 0, 0)
        }
    typeRow.addView(callTypeIcon(isVideo, accent))
    typeRow.addView(
        TextView(this).apply {
          text = if (isVideo) "Incoming video call" else "Incoming audio call"
          setTextColor(accent)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
          typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
          setPadding(dp(6), 0, 0, 0)
        })
    row.addView(typeRow)
    return row
  }

  private fun callTypeIcon(isVideo: Boolean, tint: Int): ImageView {
    val name = if (isVideo) "ic_call_video" else "ic_call_audio"
    val resId = resources.getIdentifier(name, "drawable", packageName)
    return ImageView(this).apply {
      layoutParams = LinearLayout.LayoutParams(dp(18), dp(18))
      if (resId != 0) {
        setImageResource(resId)
        setColorFilter(tint)
      }
      scaleType = ImageView.ScaleType.CENTER_INSIDE
      contentDescription = if (isVideo) "Video" else "Audio"
    }
  }

  private fun buildAvatarView(isVideo: Boolean, accent: Int): FrameLayout {
    val avatarDp = 132
    val sizePx = dp(avatarDp)
    val ringPx = dp(3)

    val outer =
        FrameLayout(this).apply {
          layoutParams =
              LinearLayout.LayoutParams(sizePx + ringPx * 2, sizePx + ringPx * 2).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(20)
              }
        }

    val ring =
        View(this).apply {
          background =
              GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke(ringPx, IncomingCallUiTheme.avatarRing(isVideo))
              }
        }
    outer.addView(
        ring,
        FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

    val avatarContainer =
        FrameLayout(this).apply {
          layoutParams =
              FrameLayout.LayoutParams(sizePx, sizePx, Gravity.CENTER).apply {
                gravity = Gravity.CENTER
              }
        }
    outer.addView(avatarContainer)

    val initials =
        TextView(this).apply {
          text = initialsFromName(callerName)
          setTextColor(Color.WHITE)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 44f)
          gravity = Gravity.CENTER
          typeface = Typeface.DEFAULT_BOLD
          background =
              GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(IncomingCallUiTheme.initialsBackground(isVideo))
              }
        }

    val avatarImage =
        ImageView(this).apply {
          layoutParams =
              FrameLayout.LayoutParams(sizePx, sizePx, Gravity.CENTER)
          scaleType = ImageView.ScaleType.CENTER_CROP
          adjustViewBounds = false
          clipToOutline = true
          outlineProvider =
              object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) {
                  outline.setOval(0, 0, view.width, view.height)
                }
              }
        }

    avatarContainer.addView(
        initials,
        FrameLayout.LayoutParams(sizePx, sizePx, Gravity.CENTER))
    avatarContainer.addView(
        avatarImage,
        FrameLayout.LayoutParams(sizePx, sizePx, Gravity.CENTER))

    IncomingCallAvatarLoader.load(
        callerAvatar, avatarImage, initials, sizePx, IncomingCallUiTheme.avatarRing(isVideo))
    startAvatarPulse(ring)
    return outer
  }

  private fun initialsFromName(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    if (parts.isEmpty()) return "?"
    if (parts.size == 1) return parts[0].take(1).uppercase()
    return (parts[0].take(1) + parts[1].take(1)).uppercase()
  }

  private fun buildCallerNameView(): TextView =
      TextView(this).apply {
        text = callerName
        setTextColor(Color.parseColor(IncomingCallUiTheme.TEXT_PRIMARY))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER
        maxLines = 2
        setPadding(dp(8), 0, dp(8), 0)
        letterSpacing = -0.01f
      }

  private fun buildCallerSubtitleView(): TextView =
      TextView(this).apply {
        text = callerSubtitle
        setTextColor(Color.parseColor(IncomingCallUiTheme.TEXT_SECONDARY))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        gravity = Gravity.CENTER
        setPadding(0, dp(6), 0, 0)
        maxLines = 1
      }

  private fun buildIncomingTypeLabel(isVideo: Boolean, accent: Int): TextView =
      TextView(this).apply {
        text = if (isVideo) "Swipe up to answer with video" else "Tap to answer"
        setTextColor(Color.parseColor(IncomingCallUiTheme.TEXT_MUTED))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        gravity = Gravity.CENTER
        setPadding(0, dp(14), 0, dp(8))
      }

  private fun buildPremiumActionRow(isVideo: Boolean, accent: Int): LinearLayout {
    val row =
        LinearLayout(this).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER
          setPadding(0, dp(12), 0, 0)
        }

    val declineCol = buildCircleActionColumn(
        label = "Decline",
        diameterDp = 68,
        fillColor = Color.parseColor(IncomingCallUiTheme.DECLINE),
        iconRes = "ic_call_end",
        iconEmoji = "✕",
        onClick = { declineCall() },
    )
    declineButton = declineCol.actionView
    row.addView(declineCol.column, actionColumnParams(endMargin = dp(40)))

    val acceptCol =
        buildCircleActionColumn(
            label = if (isVideo) "Video" else "Accept",
            diameterDp = 76,
            fillColor = accent,
            iconRes = if (isVideo) "ic_call_video" else "ic_call_audio",
            iconEmoji = if (isVideo) "📹" else "📞",
            onClick = { acceptCall() },
            glow = true,
        )
    acceptButton = acceptCol.actionView
    row.addView(acceptCol.column, actionColumnParams(startMargin = 0))
  startAcceptGlow(acceptCol.actionView, accent)
    return row
  }

  private data class ActionColumn(val column: LinearLayout, val actionView: View)

  private fun buildCircleActionColumn(
      label: String,
      diameterDp: Int,
      fillColor: Int,
      iconRes: String,
      iconEmoji: String,
      onClick: () -> Unit,
      glow: Boolean = false,
  ): ActionColumn {
    val col =
        LinearLayout(this).apply {
          orientation = LinearLayout.VERTICAL
          gravity = Gravity.CENTER_HORIZONTAL
        }
    val size = dp(diameterDp)
    val circleBg =
        GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(fillColor)
        }
    val ripple =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), circleBg, null)
        } else {
          circleBg
        }
    val circle =
        FrameLayout(this).apply {
          layoutParams = LinearLayout.LayoutParams(size, size)
          background = ripple
          isClickable = true
          isFocusable = true
          setOnClickListener {
            performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            onClick()
          }
          if (glow) {
            elevation = dp(8).toFloat()
          }
        }
    val iconId = resources.getIdentifier(iconRes, "drawable", packageName)
    if (iconId != 0) {
      circle.addView(
          ImageView(this).apply {
            setImageResource(iconId)
            setColorFilter(Color.WHITE)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            layoutParams =
                FrameLayout.LayoutParams(dp(28), dp(28), Gravity.CENTER)
          })
    } else {
      circle.addView(
          TextView(this).apply {
            text = iconEmoji
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            gravity = Gravity.CENTER
            layoutParams =
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT)
          })
    }
    col.addView(circle)
    col.addView(
        TextView(this).apply {
          text = label
          setTextColor(Color.parseColor(IncomingCallUiTheme.TEXT_SECONDARY))
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
          gravity = Gravity.CENTER
          setPadding(0, dp(10), 0, 0)
        })
    return ActionColumn(col, circle)
  }

  private fun actionColumnParams(startMargin: Int = 0, endMargin: Int = 0): LinearLayout.LayoutParams =
      LinearLayout.LayoutParams(
              LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
          .apply {
            this.marginStart = startMargin
            this.marginEnd = endMargin
          }

  private fun startAvatarPulse(ring: View) {
    stopAvatarPulse()
    avatarPulseAnimator =
        ValueAnimator.ofFloat(1f, 1.04f, 1f).apply {
          duration = 1800L
          repeatCount = ValueAnimator.INFINITE
          addUpdateListener { anim ->
            val scale = anim.animatedValue as Float
            ring.scaleX = scale
            ring.scaleY = scale
            ring.alpha = 0.85f + (scale - 1f) * 3f
          }
          start()
        }
  }

  private fun stopAvatarPulse() {
    avatarPulseAnimator?.cancel()
    avatarPulseAnimator = null
  }

  private var acceptGlowAnimator: ValueAnimator? = null

  private fun startAcceptGlow(target: View?, accent: Int) {
    acceptGlowAnimator?.cancel()
    if (target == null) return
    acceptGlowAnimator =
        ValueAnimator.ofFloat(0.92f, 1f, 0.92f).apply {
          duration = 1200L
          repeatCount = ValueAnimator.INFINITE
          addUpdateListener { anim ->
            val a = anim.animatedValue as Float
            target.scaleX = a
            target.scaleY = a
          }
          start()
        }
  }

  private fun playEnterAnimation(root: View) {
    root.alpha = 0f
    root.animate().alpha(1f).setDuration(220L).start()
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
    acceptButton?.isEnabled = false
    declineButton?.isEnabled = false
    Log.w(tag, "ACCEPT_CLICK callId=$chatId callType=$callType callerName=$callerName")
    CallLatencyTrace.mark(chatId, "ACCEPT_CLICKED")
    cancelTimeout()
    IncomingCallGuard.markAnswered(this, chatId, "accept_ui_click")
    IncomingCallUiLauncher.cancelScheduled(timeoutHandler, chatId)
    IncomingCallActionHandler.accept(
        applicationContext,
        chatId,
        callType,
        "activity",
        true,
        callerUid,
        callerName,
        callerAvatar,
        Runnable {
          stopCallService()
          if (!isFinishing) {
            runOnUiThread { finishWithReason("accept_complete") }
          }
        })
  }

  private fun declineCall() {
    if (actionInFlight) return
    actionInFlight = true
    declineButton?.isEnabled = false
    acceptButton?.isEnabled = false
    Log.d(tag, "handleDecline: callId=$chatId")
    cancelTimeout()
    stopCallService()
    IncomingCallGuard.release(this, chatId, "declined")
    IncomingCallActionHandler.decline(
        this,
        chatId,
        callType,
        "activity",
        false,
        Runnable {
          if (!isFinishing) {
            runOnUiThread { finishWithReason("decline_complete") }
          }
        })
  }

  private fun scheduleTimeout() {
    Log.d(tag, "scheduleTimeout 30000ms")
    timeoutRunnable = Runnable {
      GywIncomingCallNotifier.stopRingingAndDismissUi(this, chatId)
      IncomingCallGuard.release(this, chatId, "timeout")
      IncomingCallActionHandler.releaseTerminalLock(chatId, "timeout")
      finishWithReason("timeout_30s")
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

  private fun dp(value: Int): Int {
    return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics)
        .toInt()
  }

  companion object {
    @Volatile private var instance: IncomingCallActivity? = null

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
    fun isUiVisible(): Boolean = instance?.uiVisible == true

    @JvmStatic
    fun getVisibleCallId(): String? {
      val act = instance ?: return null
      return if (act.uiVisible && act.chatId.isNotBlank()) act.chatId else null
    }

    @JvmStatic
    fun hasWindowFocusForCall(callId: String): Boolean {
      val act = instance ?: return false
      return act.chatId == callId && act.hasWindowFocusState
    }

    @JvmStatic
    fun finishForCall(callId: String?) {
      val act = instance ?: return
      if (callId.isNullOrBlank() || act.chatId == callId) {
        act.runOnUiThread {
          if (!act.isFinishing) {
            act.finishWithReason("fast_end")
          }
        }
      }
    }

    @JvmStatic
    @JvmOverloads
    fun buildShowIntent(
        context: Context,
        callId: String,
        callerName: String?,
        callerAvatar: String?,
        callType: String?,
        callerUid: String? = null,
        callerPhone: String? = null,
    ): Intent {
      return Intent(context, IncomingCallActivity::class.java).apply {
        addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_CHAT_ID, callId)
        val resolvedName =
            IncomingCallMetadata.resolveDisplayName(
                callerUid ?: "",
                "",
                callerName ?: "",
            )
        putExtra(EXTRA_CALLER_NAME, resolvedName)
        putExtra(EXTRA_CALLER_AVATAR, callerAvatar ?: "")
        putExtra(EXTRA_CALL_TYPE, GywIncomingCallNotifier.normalizeCallType(callType))
        if (!callerUid.isNullOrBlank()) {
          putExtra(IncomingCallModule.EXTRA_CALLER_UID, callerUid)
        }
        val phone = callerPhone?.trim().orEmpty()
        if (phone.isNotEmpty()) {
          putExtra("callerPhone", phone)
        }
      }
    }
  }
}
