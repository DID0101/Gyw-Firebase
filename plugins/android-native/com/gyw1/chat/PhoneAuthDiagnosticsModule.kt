package com.gyw1.chat

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.UiThreadUtil
import com.google.android.gms.common.GoogleApiAvailability
import java.security.MessageDigest

class PhoneAuthDiagnosticsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PhoneAuthDiagnostics"

  @ReactMethod
  fun preparePhoneAuth(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val map = PhoneAuthBootstrap.prepare(reactApplicationContext)
        // Settle after WebView warm — OEM WebViews (TECNO/Oppo) need extra time before reCAPTCHA.
        Handler(Looper.getMainLooper()).postDelayed({ promise.resolve(map) }, 250)
      } catch (e: Throwable) {
        promise.reject("auth_prepare_error", e.message, e)
      }
    }
  }

  @ReactMethod
  fun clearPhoneAuthCrypto(promise: Promise) {
    try {
      val cleared = PhoneAuthBootstrap.clearStaleCryptoStorage(reactApplicationContext)
      promise.resolve(cleared)
    } catch (e: Throwable) {
      promise.reject("auth_crypto_clear_error", e.message, e)
    }
  }

  @ReactMethod
  fun getSigningFingerprints(promise: Promise) {
    try {
      val map = Arguments.createMap()
      val sha1 = Arguments.createArray()
      val sha256 = Arguments.createArray()
      val pm = reactApplicationContext.packageManager
      val pkg = reactApplicationContext.packageName
      val flags =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
          } else {
            @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
          }
      @Suppress("DEPRECATION")
      val info = pm.getPackageInfo(pkg, flags)
      val signatures =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners ?: emptyArray()
          } else {
            @Suppress("DEPRECATION") info.signatures ?: emptyArray()
          }
      for (sig in signatures) {
        val bytes = sig.toByteArray()
        sha1.pushString(digestHex(bytes, "SHA-1"))
        sha256.pushString(digestHex(bytes, "SHA-256"))
      }
      map.putArray("sha1", sha1)
      map.putArray("sha256", sha256)
      promise.resolve(map)
    } catch (e: Throwable) {
      promise.reject("auth_signing_error", e.message, e)
    }
  }

  private fun digestHex(bytes: ByteArray, algorithm: String): String {
    val md = MessageDigest.getInstance(algorithm)
    val digest = md.digest(bytes)
    return digest.joinToString(":") { b -> "%02X".format(b) }
  }

  @ReactMethod
  fun getAuthActivitySnapshot(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = reactApplicationContext.currentActivity
        val map = Arguments.createMap()
        map.putString(
            "currentActivity",
            activity?.javaClass?.name ?: "null"
        )
        map.putInt("taskId", activity?.taskId ?: -1)
        map.putString("resumedActivity", AuthLifecycleTracer.resumedActivityName ?: "null")
        val gms = GoogleApiAvailability.getInstance()
        val gmsCode = gms.isGooglePlayServicesAvailable(reactApplicationContext)
        map.putInt("playServicesStatus", gmsCode)
        promise.resolve(map)
      } catch (e: Throwable) {
        promise.reject("auth_diag_error", e.message, e)
      }
    }
  }
}
