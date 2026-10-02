package com.gyw1.chat

import android.app.ActivityManager
import android.content.pm.PackageManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Build
import android.util.Log
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

    /** Defer RN headless until native fullscreen activity has time to appear. */
    private const val DEFER_RN_AFTER_NATIVE_UI_MS = 2800L
  }

  private val deferRnHandler = Handler(Looper.getMainLooper())

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

    val processImportance = myProcessImportance(applicationContext)
    if (processImportance > ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE) {
      Log.d(TAG, "KILLED_FCM_RECEIVED msgId=${message.messageId} type=$type")
    }
    val dataOnly = message.notification == null
    Log.d(TAG, "CALL_PUSH_DATA_ONLY=$dataOnly")
    Log.d(
      TAG,
      "CALL_PAYLOAD_RECEIVED callId=${data["callId"]} type=$type " +
        "hasNotification=${message.notification != null} priority=${message.priority} " +
        "originalPriority=${message.originalPriority} keys=${data.keys}"
    )

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
        Log.d(TAG, "CALLER_TERMINAL_RECEIVED callId=$callId type=$type")
        Log.d(TAG, "CALLER_RING_STOP callId=$callId")
        Log.d(TAG, "CALLER_NOTIFICATION_CANCEL callId=$callId")
        GywIncomingCallNotifier.stopRingingAndDismissUi(applicationContext, callId)
        HeadlessCallTask.start(applicationContext, data)
        forwardToRnFirebase(message)
      }

      // ── Incoming call: full wake + ring + Telecom ─────────────���───────────
      type in INCOMING_CALL_TYPES -> handleIncomingCall(data, message)

      type in CHAT_MESSAGE_TYPES -> {
        Log.d(TAG, "chat_message FCM — GywMessageNotifier only (no call pipeline)")
        GywMessageNotifier.handleFcmMessage(applicationContext, data)
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
    val callId       = data["callId"]       ?: run { Log.w(TAG, "INCOMING_CALL missing callId"); return }
    val tsRaw        = data["timestamp"]    ?: data["ts"] ?: ""
    val tsMs         = tsRaw.toLongOrNull() ?: System.currentTimeMillis()
    if (System.currentTimeMillis() - tsMs > 30_000L) {
      Log.w(TAG, "INCOMING_CALL stale callId=$callId ageMs=${System.currentTimeMillis() - tsMs}")
      return
    }
    val callerPhone  = data["callerPhone"]  ?: data["caller_phone"] ?: ""
    val profileCallerName = data["callerName"] ?: data["caller_name"] ?: ""
    val callerUid    = data["callerUid"]    ?: data["callerId"] ?: ""
    val callerAvatar = data["callerPhotoURL"] ?: data["callerAvatar"] ?: ""
    val callTypeRaw  = data["callType"]     ?: "audio"
    val meta =
        IncomingCallMetadata.resolveFromFcm(
            callId,
            callerUid,
            callerPhone,
            profileCallerName,
            callerAvatar,
            callTypeRaw,
        )
    val callerName = meta.callerName
    val callType = meta.callType
    val ctx        = applicationContext
    val isVideo    = GywIncomingCallNotifier.isVideoCallType(callType)

    CallLatencyTrace.start(callId, "CALL_START_T0", tsMs)
    CallLatencyTrace.mark(callId, "FCM_RECEIVED")

    val processImportance = myProcessImportance(ctx)
    val processColdStart =
      processImportance >= ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED
    IncomingCallPathConfig.logActiveMode(TAG)
    Log.d(TAG, "handleIncomingCall callId=$callId caller=$callerName uid=$callerUid CALL_TYPE=$callType raw=$callTypeRaw ts=$tsMs")
    Log.w(TAG, "CALLER_META_PAYLOAD callId=$callId callerName=$callerName callerAvatar=$callerAvatar callerUid=$callerUid callType=$callType")
    Log.d(TAG, "PROCESS_WAS_COLD_STARTED=$processColdStart APP_PROCESS_RECREATED=$processColdStart importance=$processImportance")
    OemPermissionDiagnostics.log(ctx, TAG)
    IncomingCallPathConfig.logPhoneAccountAudit(ctx, TAG)

    if (!IncomingCallGuard.tryAcquire(ctx, callId, "fcm_native")) {
      Log.d(TAG, "INCOMING_UI_BLOCKED source=fcm_native callId=$callId")
      return
    }
    Log.w(TAG, "INCOMING_UI_OPEN source=fcm_native callId=$callId status=ringing")

    // 1. Dismiss any previous incoming call surface (idempotent, fast)
    GywIncomingCallNotifier.clearIncomingCallUiBeforeRinging(ctx)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      CallConnectionService.registerPhoneAccount(ctx)
    }
    val phoneAccountOk =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        CallConnectionService.isPhoneAccountRegistered(ctx)
    Log.d(TAG, "PHONE_ACCOUNT_REGISTERED=$phoneAccountOk SELF_MANAGED_CALL_ENABLED=$phoneAccountOk")

    IncomingCallProcessState.logIncomingUxContext(ctx, TAG)
    val restrictive = IncomingCallProcessState.isRestrictiveEnvironment(ctx)
    Log.d(
      TAG,
      "CALL_TYPE=$callType restrictive=$restrictive isVideo=$isVideo policy=attempt_fullscreen+notification_backup",
    )

    if (restrictive) {
      acquireWakeLock(ctx)
      Log.d(TAG, "SCREEN_WAKE_TRIGGERED source=fcm_restrictive callId=$callId")
    }

    GywIncomingCallAlerts.start(ctx, callId, callType)

    GywIncomingCallNotifier.postPremiumIncomingCallNotification(
      ctx,
      callId,
      callerName,
      callerAvatar,
      callType,
    )

    if (IncomingCallProcessState.shouldLaunchFromFcmImmediately(ctx)) {
      Log.w(TAG, "FULLSCREEN_ATTEMPTED=true source=fcm_foreground callId=$callId")
      val launched =
          IncomingCallUiLauncher.launchDirect(
              ctx,
              callId,
              callerName,
              callerAvatar,
              callType,
              "fcm_foreground",
              callerUid,
              meta.callerPhone,
          )
      Log.d(TAG, "foreground incoming call directLaunch=$launched callId=$callId")
      IncomingCallUiLauncher.logFullscreenAttemptResult(ctx, callId, launched, 500L)
    }

    val telecomHandled =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        CallConnectionService.addIncomingCall(
          ctx, callId, callerName, callType, callerAvatar, callerUid,
        )
      } else {
        false
      }
    Log.d(TAG, "TELECOM_CALL_ADDED=$telecomHandled callType=$callType isVideo=$isVideo")
    if (telecomHandled) {
      CallLatencyTrace.mark(callId, "TELECOM_INCOMING_ADDED")
    }

    try {
      Log.d(TAG, "CALL_UI_MODE=attempt_fullscreen_with_notification_backup")
      val svc = Intent(ctx, GywIncomingCallService::class.java).apply {
        putExtra(GywIncomingCallService.EXTRA_CALL_ID, callId)
        putExtra(GywIncomingCallService.EXTRA_CALLER_NAME, callerName)
        putExtra(GywIncomingCallService.EXTRA_CALLER_AVATAR, meta.callerAvatar)
        putExtra(GywIncomingCallService.EXTRA_CALL_TYPE, callType)
        putExtra("callerUid", meta.callerUid)
        putExtra("callerPhone", meta.callerPhone)
        putExtra(GywIncomingCallService.EXTRA_FULL_SCREEN_MODE, restrictive)
        putExtra(GywIncomingCallService.EXTRA_TELECOM_DISPATCHED, telecomHandled)
      }
      ContextCompat.startForegroundService(ctx, svc)
      Log.d(TAG, "GywIncomingCallService startForegroundService dispatched")
    } catch (e: Exception) {
      Log.e(TAG, "startForegroundService failed: ${e.message}")
      GywIncomingCallNotifier.postPremiumIncomingCallNotification(
        ctx,
        callId,
        callerName,
        callerAvatar,
        callType,
      )
    }

    val deferRn = restrictive || IncomingCallProcessState.shouldAttemptFullscreenActivity(ctx)
    if (deferRn) {
      Log.d(TAG, "DEFER_RN_HEADLESS ms=$DEFER_RN_AFTER_NATIVE_UI_MS callId=$callId")
      deferRnHandler.postDelayed({
        HeadlessCallTask.start(ctx, data)
        forwardToRnFirebase(message)
      }, DEFER_RN_AFTER_NATIVE_UI_MS)
    } else {
      HeadlessCallTask.start(ctx, data)
      forwardToRnFirebase(message)
    }
  }

  // ── Screen / process state helpers ───────────────────────────────────────

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
