package com.gyw1.chat

import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * RN bridge for full-screen incoming call UI when the app is backgrounded or killed.
 * Primary FCM handling remains in [GywFirebaseMessagingService]; these methods are
 * invoked from JS [registerBackgroundMessaging] as a backup and for explicit launches.
 */
class IncomingCallModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun showIncomingCallScreen(callData: ReadableMap) {
    val ctx = reactApplicationContext
    val callId = callData.getString("callId")?.trim().orEmpty()
    if (callId.isEmpty()) {
      Log.w(TAG, "showIncomingCallScreen: missing callId")
      return
    }

    val callerUid = callData.getString("callerUid") ?: callData.getString("callerId") ?: ""
    val callerPhone = callData.getString("callerPhone")?.trim().orEmpty()
    val rawName = callData.getString("callerName")?.trim().orEmpty()
    val callerPhotoURL =
        callData.getString("callerPhotoURL")?.trim()
            ?: callData.getString("callerAvatar")?.trim()
            ?: ""
    val callType =
        GywIncomingCallNotifier.normalizeCallType(
            callData.getString("callType") ?: "audio"
        )
    val callerName =
        IncomingCallMetadata.resolveDisplayName(callerUid, callerPhone, rawName)

    if (!IncomingCallGuard.tryAcquire(ctx, callId, "rn_incoming_module")) {
      Log.d(TAG, "showIncomingCallScreen: guard blocked callId=$callId")
      return
    }

    IncomingCallPathConfig.logActiveMode(TAG)

    Log.d(
        TAG,
        "showIncomingCallScreen callId=$callId callType=$callType callerUid=$callerUid"
    )

    GywIncomingCallAlerts.start(ctx, callId, callType)

    GywIncomingCallNotifier.postPremiumIncomingCallNotification(
        ctx, callId, callerName, callerPhotoURL, callType)

    val activity = reactContext.currentActivity
    val launchCtx = activity ?: ctx
    var launched = false
    try {
      launched =
          IncomingCallUiLauncher.launchDirect(
              launchCtx,
              callId,
              callerName,
              callerPhotoURL,
              callType,
              if (activity != null) "incoming_call_module_activity" else "incoming_call_module",
          )
      if (launched) {
        Log.d(TAG, "showIncomingCallScreen launchDirect SUCCESS ctx=${launchCtx.javaClass.simpleName}")
      }
    } catch (e: Exception) {
      Log.e(TAG, "showIncomingCallScreen launchDirect FAILED: ${e.message}", e)
    }
    if (!launched && activity != null) {
      try {
        launched =
            IncomingCallUiLauncher.launchDirect(
                ctx,
                callId,
                callerName,
                callerPhotoURL,
                callType,
                "incoming_call_module_app",
            )
        if (launched) {
          Log.d(TAG, "showIncomingCallScreen fallback appContext SUCCESS")
        }
      } catch (e: Exception) {
        Log.e(TAG, "showIncomingCallScreen fallback FAILED: ${e.message}", e)
      }
    }

    if (!launched) {
      val bundle =
          android.os.Bundle().apply {
            putString("type", "incoming_call")
            putString("callId", callId)
            putString("callerName", callerName)
            putString("callerAvatar", callerPhotoURL)
            putString("callType", callType)
            putString("callerUid", callerUid)
          }
      GywIncomingCallNotifier.show(ctx, bundle, true)
    }
  }

  /**
   * Instant teardown from JS — stop ring, cancel notification/FGS, Telecom, finish activity.
   */
  @ReactMethod
  fun fastDismissCall(callId: String?) {
    val ctx = reactApplicationContext
    val id = callId?.trim().orEmpty()
    Log.w(TAG, "CALL_TERMINATION_START fastDismissCall callId=$id")
    GywIncomingCallAlerts.stop(ctx)
    GywIncomingCallNotifier.stopRingingAndDismissUi(ctx, if (id.isEmpty()) null else id)
    if (id.isNotEmpty()) {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
        CallConnectionService.reportCallEnded(ctx, id)
      }
      IncomingCallGuard.release(ctx, id, "fast_dismiss_rn")
      IncomingCallActivity.finishForCall(id)
    }
    try {
      val dismiss =
          Intent(ACTION_DISMISS_INCOMING_CALL).apply {
            setPackage(ctx.packageName)
            if (id.isNotEmpty()) {
              putExtra(IncomingCallActivity.EXTRA_CALL_ID, id)
              putExtra(IncomingCallActivity.EXTRA_CHAT_ID, id)
            }
          }
      ctx.sendBroadcast(dismiss)
    } catch (e: Exception) {
      Log.w(TAG, "fastDismiss broadcast failed: ${e.message}")
    }
    Log.d(TAG, "CALL_UI_DISMISS_MS fastDismissCall done callId=$id")
  }

  @ReactMethod
  fun dismissIncomingCallScreen(callId: String?) {
    val ctx = reactApplicationContext
    val id = callId?.trim().orEmpty()
    Log.d(TAG, "dismissIncomingCallScreen callId=$id")
    GywIncomingCallNotifier.stopRingingAndDismissUi(ctx, if (id.isEmpty()) null else id)
    IncomingCallGuard.release(ctx, id, "dismiss_rn_module")

    try {
      val dismiss =
          Intent(ACTION_DISMISS_INCOMING_CALL).apply {
            setPackage(ctx.packageName)
            if (id.isNotEmpty()) {
              putExtra(IncomingCallActivity.EXTRA_CALL_ID, id)
              putExtra(IncomingCallActivity.EXTRA_CHAT_ID, id)
            }
          }
      ctx.sendBroadcast(dismiss)
    } catch (e: Exception) {
      Log.w(TAG, "dismiss broadcast failed: ${e.message}")
    }
  }

  /**
   * Returns extras from the intent that launched MainActivity (ANSWER_CALL / gyw://call/…),
   * or null if the app was opened normally.
   */
  @ReactMethod
  fun isNativeIncomingCallVisible(promise: Promise) {
    try {
      promise.resolve(IncomingCallActivity.isUiVisible())
    } catch (e: Exception) {
      promise.reject("ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun getInitialCallIntent(promise: Promise) {
    try {
      val activity = reactContext.currentActivity
      val intent = activity?.intent
      if (intent == null) {
        promise.resolve(null)
        return
      }

      val fromAnswerAction = intent.action == ACTION_ANSWER_CALL
      val data = intent.data
      val callIdFromUri =
          if (data != null && "gyw" == data.scheme && data.host == "call") {
            data.pathSegments?.lastOrNull()?.trim().orEmpty()
          } else {
            ""
          }

      val callId =
          intent.getStringExtra(EXTRA_CALL_ID)?.trim().orEmpty().ifEmpty { callIdFromUri }

      if (callId.isEmpty()) {
        promise.resolve(null)
        return
      }

      val callType =
          GywIncomingCallNotifier.normalizeCallType(
              intent.getStringExtra(EXTRA_CALL_TYPE)
                  ?: intent.getStringExtra("callType")
                  ?: "audio"
          )
      val callerUid =
          intent.getStringExtra(EXTRA_CALLER_UID)
              ?: intent.getStringExtra(EXTRA_CALLER_ID)
              ?: ""
      val autoAccept =
          intent.getBooleanExtra(EXTRA_AUTO_ACCEPT, false) ||
              intent.getBooleanExtra(EXTRA_ACCEPTED, false) ||
              intent.getBooleanExtra("accept", false) ||
              (data?.getQueryParameter("accept") == "1")
      val answered = fromAnswerAction || autoAccept

      val map: WritableMap =
          Arguments.createMap().apply {
            putString("callId", callId)
            putString("callType", callType)
            putString("callerUid", callerUid)
            putBoolean("answered", answered)
            putBoolean("autoAccept", autoAccept)
            putString("callerName", intent.getStringExtra(EXTRA_CALLER_NAME) ?: "")
            putString(
                "callerPhotoURL",
                intent.getStringExtra(EXTRA_CALLER_PHOTO_URL)
                    ?: intent.getStringExtra(EXTRA_CALLER_AVATAR)
                    ?: ""
            )
          }

      Log.w(TAG, "ACCEPT_GET_INITIAL_INTENT callId=$callId answered=$answered autoAccept=$autoAccept")
      promise.resolve(map)
    } catch (e: Exception) {
      Log.e(TAG, "getInitialCallIntent error: ${e.message}")
      promise.reject("ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun checkFullScreenIntentPermission(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val nm =
            reactApplicationContext.getSystemService(android.app.NotificationManager::class.java)
        promise.resolve(nm?.canUseFullScreenIntent() == true)
      } else {
        promise.resolve(true)
      }
    } catch (e: Exception) {
      Log.e(TAG, "checkFullScreenIntentPermission error: ${e.message}")
      promise.reject("ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun requestFullScreenIntentPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      try {
        val intent =
            Intent(
                    android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    android.net.Uri.parse("package:${reactApplicationContext.packageName}"),
                )
                .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
        reactApplicationContext.startActivity(intent)
      } catch (e: Exception) {
        Log.e(TAG, "requestFullScreenIntentPermission error: ${e.message}")
      }
    }
  }

  companion object {
    const val NAME = "IncomingCallModule"
    private const val TAG = "IncomingCallModule"

    const val ACTION_DISMISS_INCOMING_CALL = "com.gyw1.chat.DISMISS_INCOMING_CALL"
    const val ACTION_ANSWER_CALL = "ANSWER_CALL"

    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALL_TYPE = "callType"
    const val EXTRA_CALLER_UID = "callerUid"
    const val EXTRA_CALLER_ID = "callerId"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_CALLER_PHOTO_URL = "callerPhotoURL"
    const val EXTRA_CALLER_AVATAR = "callerAvatar"
    const val EXTRA_ACCEPTED = "accepted"
    const val EXTRA_AUTO_ACCEPT = "autoAccept"

    private fun emit(event: String, payload: WritableMap) {
      val ctx = reactContextRef?.get() ?: IncomingCallBridgeModule.getAppContext()
      if (ctx == null) {
        Log.w(TAG, "ACCEPT_JS_EMIT_FAILED event=$event reason=react_context_null")
        return
      }
      if (reactContextRef?.get() == null) {
        attachContext(ctx)
      }
      val runnable = Runnable {
        try {
          ctx
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit(event, payload)
          if (event == "onAnswerCall") {
            Log.w(TAG, "ACCEPT_JS_EMIT_OK event=onAnswerCall callId=${payload.getString("callId")}")
          }
        } catch (e: Exception) {
          Log.w(TAG, "ACCEPT_JS_EMIT_FAILED event=$event reason=${e.message}")
        }
      }
      if (ctx.hasActiveReactInstance()) {
        ctx.runOnUiQueueThread(runnable)
      } else {
        runnable.run()
      }
    }

    @JvmStatic
    fun emitAnswerCall(callId: String, callType: String, callerUid: String) {
      val map =
          Arguments.createMap().apply {
            putString("callId", callId)
            putString("callType", callType)
            putString("callerUid", callerUid)
          }
      emit("onAnswerCall", map)
    }

    @JvmStatic
    fun emitDeclineCall(callId: String, callType: String) {
      val map =
          Arguments.createMap().apply {
            putString("callId", callId)
            putString("callType", callType)
          }
      emit("onDeclineCall", map)
    }

    private var reactContextRef: java.lang.ref.WeakReference<ReactApplicationContext>? = null

    @JvmStatic
    fun attachContext(ctx: ReactApplicationContext) {
      reactContextRef = java.lang.ref.WeakReference(ctx)
    }
  }

  init {
    attachContext(reactContext)
  }
}
