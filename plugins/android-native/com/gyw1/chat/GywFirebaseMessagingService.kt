package com.gyw1.chat

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.pm.PackageManager
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.os.PowerManager
import android.os.Build
import android.util.Log
import android.view.Display
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.invertase.firebase.app.ReactNativeFirebaseApp
import io.invertase.firebase.common.ReactNativeFirebaseEventEmitter
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingHeadlessService
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingSerializer
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingStoreHelper

/**
 * GywFirebaseMessagingService — Kotlin rewrite.
 *
 * Replaces both:
 *   - the old GywFirebaseMessagingService.java
 *   - ReactNativeFirebaseMessagingService (which has a no-op onMessageReceived)
 *
 * Incoming-call dispatch strategy (in order of preference):
 *
 *   1. HeadlessCallTask  — always started; gives JS 30 s to update Firestore / cache
 *   2. Telecom path      — TelecomManager.addNewIncomingCall() → CallConnectionService
 *                          (preferred: OS-aware call state, Bluetooth, car-kit)
 *   3. FGS path          — GywIncomingCallService (phone-call foreground service)
 *                          always started as a parallel / fallback ring path because:
 *                          (a) some OEMs do not honour self-managed connections
 *                          (b) Telecom path requires O+ and MANAGE_OWN_CALLS
 *                          Both paths are guarded by GywIncomingCallNotifier.clearIncomingCallUiBeforeRinging()
 *                          so only one notification slot is visible.
 *
 * Android 12+ restriction:
 *   startForegroundService() from background is blocked unless called from an exempt
 *   context.  FirebaseMessagingService.onMessageReceived() IS exempt when the message
 *   has priority:high (data-only FCM).  Keep this service as thin as possible; any
 *   async work that might run past the 10-second FCM window goes into HeadlessCallTask.
 *
 * Android 13 notification permission:
 *   POST_NOTIFICATIONS must be granted at runtime.  Incoming-call notifications use
 *   CATEGORY_CALL + IMPORTANCE_MAX; Android grants display even without POST_NOTIFICATIONS
 *   for FOREGROUND_SERVICE_PHONE_CALL services on API 33+ — but requesting the permission
 *   is still best practice and should be done from the React Native layer on first launch.
 */
class GywFirebaseMessagingService : FirebaseMessagingService() {

  companion object {
    private const val TAG = "GywFcmService"

    // ── Data payload type values ──────────────────────────────────────────────
    private val INCOMING_CALL_TYPES = setOf("call", "incoming_call", "INCOMING_CALL")
    private val CANCEL_TYPES        = setOf(
      "call_cancelled", "incoming_call_cancelled", "call_ended", "CALL_CANCELLED"
    )

    /** Chat pushes — handled only by {@link GywMessageNotifier} (separate channels from calls). */
    private val CHAT_MESSAGE_TYPES = setOf("chat_message", "CHAT_MESSAGE")
  }

  // ── onMessageReceived ─────────────────────────────────────────────────────
  //
  // Called for ALL FCM data messages: app in foreground, background, OR killed.
  // The OS grants a short execution window (~10 s); anything slower must be
  // delegated to HeadlessCallTask or a WorkManager job.

  override fun onMessageReceived(message: RemoteMessage) {
    logIncomingEnvironment(message)

    val data = message.data.toMutableMap()
    var type = data["type"] ?: ""

    // Data-only FCM is required for killed-state delivery. If the server mistakenly
    // adds a notification payload, we still try to infer an incoming call from `data`.
    if (type.isEmpty() && !data["callId"].isNullOrEmpty()) {
      type = "incoming_call"
      data["type"] = type
    }

    val callState = if (GywIncomingCallNotifier.hasActiveIncomingCallUi(applicationContext)) "active" else "idle"
    Log.d(
      TAG, "onMessageReceived msgId=${message.messageId} type=$type" +
           " dataKeys=${data.keys} hasNotification=${message.notification != null}"
    )
    Log.d(TAG, "MSG_PUSH_RECEIVED callState=$callState")
    Log.d(TAG, "MSG_PUSH_TYPE=$type")
    Log.d(TAG, "onMessageReceived payload=$data")

    if (message.notification != null) {
      Log.w(
        TAG,
        "FCM message contains top-level notification payload — " +
        "Android may show a system banner and skip data-only handling. " +
        "Cloud Function should send data-only messages for call and chat events."
      )
      Log.w(
        TAG,
        "fallbackPath=FCM_SYSTEM_NOTIFICATION (small notification likely created by OS, not GywIncomingCallNotifier)"
      )
    }

    when {
      // ── Cancellation: stop ring + dismiss UI immediately ──────────────────
      type in CANCEL_TYPES -> {
        val callId = data["callId"]
        Log.d(TAG, "cancel/end push callId=$callId type=$type")
        GywIncomingCallNotifier.stopRingingAndDismissUi(applicationContext, callId)
        HeadlessCallTask.start(applicationContext, data)
        forwardToRnFirebase(message)
      }

      // ── Incoming call: full wake + ring + Telecom ─────────────���───────────
      type in INCOMING_CALL_TYPES -> handleIncomingCall(data, message)

      type in CHAT_MESSAGE_TYPES -> {
        Log.d(TAG, "chat_message FCM — GywMessageNotifier only (no call pipeline)")
        GywMessageNotifier.handleFcmMessage(applicationContext, data)
        forwardToRnFirebase(message)
      }

      // ── All other types: forward to RN Firebase JS layer ─────────────────
      else -> {
        Log.d(TAG, "non-call FCM type=$type — forwarding to RN Firebase")
        forwardToRnFirebase(message)
      }
    }
  }

  // ── Incoming call orchestration ───────────────────────────────────────────

  private fun handleIncomingCall(data: Map<String, String>, message: RemoteMessage) {
    val callId     = data["callId"]     ?: run { Log.w(TAG, "INCOMING_CALL missing callId"); return }
    val callerName = data["callerName"] ?: "Incoming call"
    val callType   = data["callType"]   ?: "audio"
    val ctx        = applicationContext

    Log.d(TAG, "handleIncomingCall callId=$callId caller=$callerName type=$callType")
    if (!IncomingCallGuard.tryAcquire(ctx, callId, "fcm_native")) {
      return
    }

    // 1. Dismiss any previous incoming call surface (idempotent, fast)
    GywIncomingCallNotifier.clearIncomingCallUiBeforeRinging(ctx)

    // 2. Start HeadlessCallTask so JS can update Firestore / local cache.
    //    Do this BEFORE the FGS so the WakeLock window starts immediately.
    HeadlessCallTask.start(ctx, data)

    // 3. Acquire an explicit WakeLock so the screen wakes on lock-screen arrival.
    acquireWakeLock(ctx)

    // 3a. Start ring/vibrate immediately from the FCM service context.
    //     GywIncomingCallService also calls start() — idempotent for the same callId.
    //     This ensures ringing happens even on highly restrictive OEM builds where
    //     startForegroundService() is delayed or silently killed before the service
    //     can call startForeground().
    GywIncomingCallAlerts.start(ctx, callId)

    // 4. Telecom path (Android O+, MANAGE_OWN_CALLS granted).
    //    Registers the call with the OS Telecom subsystem; provides Bluetooth
    //    headset integration, system-level mute, etc.
    val telecomHandled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      CallConnectionService.addIncomingCall(ctx, callId, callerName, callType)
    } else {
      false
    }
    Log.d(TAG, "Telecom path: telecomHandled=$telecomHandled")

    // 5. FGS path — always start alongside Telecom because:
    //    (a) CAPABILITY_SELF_MANAGED phones still need our custom UI
    //    (b) some OEMs silently drop self-managed connections
    //    GywIncomingCallService calls startForeground(FOREGROUND_SERVICE_TYPE_PHONE_CALL)
    //    and launches IncomingCallActivity.
    try {
      val fullScreenIncomingUi = shouldUseFullPresentation(ctx)
      Log.d(
        TAG,
        "CALL_UI_MODE = " + if (fullScreenIncomingUi) "FULLSCREEN_LOCKED" else "HEADSUP_UNLOCKED"
      )
      val svc = Intent(ctx, GywIncomingCallService::class.java).apply {
        putExtra(GywIncomingCallService.EXTRA_CALL_ID,    callId)
        putExtra(GywIncomingCallService.EXTRA_CALLER_NAME, callerName)
        putExtra(GywIncomingCallService.EXTRA_CALL_TYPE,  callType)
        putExtra(GywIncomingCallService.EXTRA_FULL_SCREEN_MODE, fullScreenIncomingUi)
      }
      ContextCompat.startForegroundService(ctx, svc)
      Log.d(TAG, "GywIncomingCallService startForegroundService dispatched")
    } catch (e: Exception) {
      Log.e(TAG, "startForegroundService failed — falling back to notifier: ${e.message}")
      // Last resort: post a high-priority notification without a foreground service.
      // This will not wake the screen on killed state but is better than nothing.
      val bundle = android.os.Bundle().apply { data.forEach { (k, v) -> putString(k, v) } }
      val fullScreenIncomingUi = shouldUseFullPresentation(ctx)
      Log.d(
        TAG,
        "CALL_UI_MODE = " + if (fullScreenIncomingUi) "FULLSCREEN_LOCKED" else "HEADSUP_UNLOCKED"
      )
      GywIncomingCallNotifier.show(ctx, bundle, fullScreenIncomingUi)
    }

    // 6. Forward to RN Firebase so the foreground onMessage() / JS listeners fire
    //    if the app happens to be in foreground (navigation, state sync).
    forwardToRnFirebase(message)
  }

  // ── Screen / process state helpers ───────────────────────────────────────

  /**
   * True when the device is asleep, locked, or screen-off.
   * Full-screen intent should be used in this case.
   * When the user is in another app (screen on, unlocked), heads-up only.
   */
  @Suppress("DEPRECATION")
  private fun shouldUseFullPresentation(ctx: Context): Boolean {
    val pm  = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val km  = ctx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    val interactive  = pm?.isInteractive ?: true
    val keyguardLocked = km?.isKeyguardLocked ?: false
    val displayOff   = isDefaultDisplayOff(ctx)
    return keyguardLocked || !interactive || displayOff
  }

  private fun isDefaultDisplayOff(ctx: Context): Boolean {
    return try {
      val dm = ctx.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
      dm?.getDisplay(Display.DEFAULT_DISPLAY)?.state == Display.STATE_OFF
    } catch (_: Exception) { false }
  }

  // ── WakeLock ──────────────────────────────────────────────────────────────

  @Suppress("DEPRECATION")
  private fun acquireWakeLock(ctx: Context) {
    try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      val wl = pm.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
        PowerManager.ACQUIRE_CAUSES_WAKEUP   or
        PowerManager.ON_AFTER_RELEASE,
        "gyw:fcm_incoming_call_wake"
      )
      wl.acquire(30_000L) // auto-released after 30 s maximum
      Log.d(TAG, "WakeLock acquired 30 s")
    } catch (e: Exception) {
      Log.w(TAG, "WakeLock acquire failed: ${e.message}")
    }
  }

  // ── Forward to RN Firebase ────────────────────────────────────────────────
  //
  // Forwards the message to the RN Firebase event emitter so the JS-layer
  // setBackgroundMessageHandler / onMessage listener also fires.
  // Skipped if the app process is not visible (avoids a crash in the headless context).

  private fun forwardToRnFirebase(message: RemoteMessage) {
    try {
      if (ReactNativeFirebaseApp.getApplicationContext() == null) {
        ReactNativeFirebaseApp.setApplicationContext(applicationContext)
      }

      val emitter  = ReactNativeFirebaseEventEmitter.getSharedInstance()
      val appProcImportance = myProcessImportance(applicationContext)
      val isFgOrVisible     = appProcImportance <=
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE

      if (message.notification != null) {
        try {
          ReactNativeFirebaseMessagingStoreHelper
            .getInstance()
            .messagingStore
            .storeFirebaseMessage(message)
        } catch (t: Throwable) {
          Log.w(TAG, "storeFirebaseMessage: ${t.message}")
        }
      }

      if (isFgOrVisible) {
        emitter.sendEvent(
          ReactNativeFirebaseMessagingSerializer.remoteMessageToEvent(message, false)
        )
        return
      }

      // Headless: start RN Firebase headless service so setBackgroundMessageHandler fires.
      val bgIntent = Intent(applicationContext, ReactNativeFirebaseMessagingHeadlessService::class.java)
        .putExtra("message", message)
      val name = applicationContext.startService(bgIntent)
      if (name != null) {
        HeadlessJsTaskService.acquireWakeLockNow(applicationContext)
      }
    } catch (e: Exception) {
      Log.e(TAG, "forwardToRnFirebase error: ${e.message}")
    }
  }

  private fun myProcessImportance(ctx: Context): Int {
    val am   = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return 1000
    val pkg  = ctx.packageName
    return am.runningAppProcesses
      ?.firstOrNull { it?.processName == pkg }
      ?.importance
      ?: 1000
  }

  private fun logIncomingEnvironment(message: RemoteMessage) {
    val ctx = applicationContext
    val manufacturer = Build.MANUFACTURER ?: "unknown"
    val brand = Build.BRAND ?: "unknown"
    val model = Build.MODEL ?: "unknown"
    val sdk = Build.VERSION.SDK_INT
    val release = Build.VERSION.RELEASE ?: "unknown"
    val hasNotificationPayload = message.notification != null
    val processImportance = myProcessImportance(ctx)
    val power = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val isIgnoringBatteryOptimization =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        power?.isIgnoringBatteryOptimizations(ctx.packageName) ?: true
      } else true
    val isBackgroundRestricted =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        am?.isBackgroundRestricted ?: false
      } else false
    val postNotificationsGranted =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(
          ctx,
          android.Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
      } else true

    Log.d(
      TAG,
      "env manufacturer=$manufacturer brand=$brand model=$model sdk=$sdk release=$release " +
        "processImportance=$processImportance hasNotificationPayload=$hasNotificationPayload " +
        "ignoreBatteryOpt=$isIgnoringBatteryOptimization bgRestricted=$isBackgroundRestricted " +
        "postNotificationsGranted=$postNotificationsGranted"
    )
  }
}
