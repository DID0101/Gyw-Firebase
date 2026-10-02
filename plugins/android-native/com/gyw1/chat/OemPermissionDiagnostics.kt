package com.gyw1.chat

import android.app.ActivityManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/** Runtime OEM / policy probes for killed-state incoming call debugging. */
object OemPermissionDiagnostics {
  fun log(context: Context, tag: String) {
    val app = context.applicationContext
    val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    val am = app.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager

    val batteryOptIgnored =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        pm?.isIgnoringBatteryOptimizations(app.packageName) == true
      } else {
        true
      }
    val bgRestricted =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        am?.isBackgroundRestricted == true
      } else {
        false
      }
    val canFsi =
      if (Build.VERSION.SDK_INT >= 34) {
        nm?.canUseFullScreenIntent() == true
      } else {
        true
      }
    val overlayAllowed =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(app)
      } else {
        true
      }

    val manufacturer = Build.MANUFACTURER ?: "unknown"
    val brand = Build.BRAND ?: "unknown"
    val restrictiveOem =
      manufacturer.lowercase().let { m ->
        m.contains("tecno") || m.contains("infinix") || m.contains("itel") ||
          m.contains("oppo") || m.contains("realme") || m.contains("vivo") ||
          m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")
      } ||
        brand.lowercase().let { b ->
          b.contains("tecno") || b.contains("infinix") || b.contains("oppo") ||
            b.contains("realme") || b.contains("vivo") || b.contains("xiaomi")
        }

    // Autostart cannot be read programmatically on most OEMs — log as unknown.
    val autostartAllowed = !restrictiveOem || batteryOptIgnored

    Log.d(
      tag,
      "OEM_DIAG manufacturer=$manufacturer brand=$brand " +
        "OEM_BACKGROUND_POPUP_ALLOWED=$overlayAllowed " +
        "OEM_AUTOSTART_ALLOWED=unknown_best_effort=$autostartAllowed " +
        "BATTERY_OPT_IGNORED=$batteryOptIgnored BG_RESTRICTED=$bgRestricted " +
        "CAN_USE_FULL_SCREEN_INTENT=$canFsi OEM_BLOCK_LIKELY=${restrictiveOem && (!batteryOptIgnored || bgRestricted)}"
    )
  }
}
