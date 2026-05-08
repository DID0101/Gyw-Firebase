package com.gyw1.chat

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

class IncomingCallBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  init {
    appContextRef = WeakReference(reactContext)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun acknowledgeIncomingCallEvent() {
    // JS can call to ensure module init; no-op by design.
  }

  // ── Battery optimization exemption ────────────────────────────────────────
  // Required for reliable FCM delivery in killed state on OEM devices
  // (Xiaomi MIUI, Huawei EMUI, Samsung, Oppo, etc.).

  /**
   * Returns true if the app is already exempt from battery optimization,
   * or if the API does not require exemption (pre-M).
   */
  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        promise.resolve(true)
        return
      }
      val pm = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      val ignoring = pm?.isIgnoringBatteryOptimizations(reactContext.packageName) ?: true
      promise.resolve(ignoring)
    } catch (e: Exception) {
      Log.w(NAME, "isIgnoringBatteryOptimizations: ${e.message}")
      promise.resolve(true) // assume ok on error — don't spam user
    }
  }

  /**
   * Opens the system dialog / settings page asking the user to exempt this
   * app from battery optimization.  Resolves immediately (does not wait for
   * user interaction — check isIgnoringBatteryOptimizations() afterwards).
   */
  @ReactMethod
  fun requestIgnoreBatteryOptimizations(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        promise.resolve(null)
        return
      }
      val pm = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (pm?.isIgnoringBatteryOptimizations(reactContext.packageName) == true) {
        // Already exempt — nothing to do.
        promise.resolve(null)
        return
      }
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      Log.w(NAME, "requestIgnoreBatteryOptimizations: ${e.message}")
      // Fallback: open the general battery optimization list
      try {
        val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(fallback)
        promise.resolve(null)
      } catch (e2: Exception) {
        promise.reject("ERROR", "Cannot open battery optimization settings: ${e2.message}")
      }
    }
  }

  // ── USE_FULL_SCREEN_INTENT (Android 14 / API 34+) ─────────────────────────
  // Apps with MANAGE_OWN_CALLS are auto-granted on Android 14, but some OEMs
  // may override this.  Check and prompt if needed.

  /**
   * Returns true if the app can use full-screen intents (i.e. show
   * IncomingCallActivity over the lock screen).  Always true below API 34.
   */
  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < 34) {
        promise.resolve(true)
        return
      }
      val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      promise.resolve(nm?.canUseFullScreenIntent() ?: true)
    } catch (e: Exception) {
      Log.w(NAME, "canUseFullScreenIntent: ${e.message}")
      promise.resolve(true)
    }
  }

  /**
   * Opens the system settings page where the user can grant
   * USE_FULL_SCREEN_INTENT for this app.  No-op below API 34.
   */
  @ReactMethod
  fun openFullScreenIntentSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < 34) {
        promise.resolve(null)
        return
      }
      val intent = Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT").apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      Log.w(NAME, "openFullScreenIntentSettings: ${e.message}")
      promise.reject("ERROR", e.message)
    }
  }

  companion object {
    private const val NAME = "IncomingCallBridge"
    private var appContextRef: WeakReference<ReactApplicationContext>? = null

    private fun emit(event: String, payload: WritableMap) {
      val context = appContextRef?.get() ?: return
      context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(event, payload)
    }

    @JvmStatic
    fun emitIncomingCallAccepted(chatId: String, callType: String) {
      val map = Arguments.createMap().apply {
        putString("chatId", chatId)
        putString("callType", callType)
        putBoolean("accepted", true)
      }
      emit("IncomingCallAccepted", map)
    }

    @JvmStatic
    fun emitIncomingCallDeclined(chatId: String, callType: String) {
      val map = Arguments.createMap().apply {
        putString("chatId", chatId)
        putString("callType", callType)
        putBoolean("accepted", false)
      }
      emit("IncomingCallDeclined", map)
    }
  }
}

