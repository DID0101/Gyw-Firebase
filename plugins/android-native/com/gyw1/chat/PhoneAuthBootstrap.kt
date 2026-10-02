package com.gyw1.chat

import android.app.KeyguardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * Optional diagnostics for Firebase Phone Auth. Does not modify Firebase crypto storage —
 * clearing those prefs breaks reCAPTCHA on many OEM devices.
 */
object PhoneAuthBootstrap {
  private const val TAG = "AUTH_PHONE"

  private val CRYPTO_PREFS = listOf(
      "com.google.firebase.auth.api.crypto",
      "com.google.firebase.auth.api.Store",
      "com.google.firebase.auth.internal",
  )

  fun prepare(context: Context): WritableMap {
    val map = Arguments.createMap()
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val deviceSecure = keyguard.isDeviceSecure
    map.putBoolean("deviceSecure", deviceSecure)
    map.putBoolean("cryptoCleared", false)

    warmWebViewOnMainThread(context)

    if (!deviceSecure) {
      Log.w(TAG, "AUTH_PREPARE_WARN no_screen_lock — reCAPTCHA Keystore may fail on some OEM devices")
    }
    Log.i(TAG, "AUTH_PREPARE_DONE deviceSecure=$deviceSecure")
    return map
  }

  /** Manual recovery only — never call automatically before OTP. */
  fun clearStaleCryptoStorage(context: Context): Boolean {
    var cleared = false
    for (name in CRYPTO_PREFS) {
      try {
        context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().apply()
        cleared = true
      } catch (_: Throwable) {
        /* ignore */
      }
      try {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
          context.deleteSharedPreferences(name)
          cleared = true
        }
      } catch (_: Throwable) {
        /* ignore */
      }
    }
    if (cleared) {
      Log.i(TAG, "AUTH_CRYPTO_CLEARED prefs=${CRYPTO_PREFS.joinToString()}")
    }
    return cleared
  }

  /** Must finish before OTP — load minimal HTML so WebView/Chromium is fully initialized. */
  private fun warmWebViewOnMainThread(context: Context) {
    val warm = {
      try {
        CookieManager.getInstance()
        val webView = WebView(context.applicationContext)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.loadData(
          "<html><head></head><body><script>window.__gywWarm=1</script></body></html>",
          "text/html",
          "UTF-8"
        )
        // Let Chromium finish init before destroy — synchronous tick for OEM WebViews (TECNO/Oppo).
        Thread.sleep(150)
        webView.destroy()
        Log.i(TAG, "AUTH_WEBVIEW_WARMED")
      } catch (e: Throwable) {
        Log.w(TAG, "AUTH_WEBVIEW_WARM_FAIL ${e.message}")
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      warm()
    } else {
      Handler(Looper.getMainLooper()).post { warm() }
    }
  }
}
