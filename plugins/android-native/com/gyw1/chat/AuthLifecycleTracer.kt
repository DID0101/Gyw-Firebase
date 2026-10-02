package com.gyw1.chat

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.util.Log

/**
 * Logs activity lifecycle for Firebase Phone Auth / reCAPTCHA debugging (logcat tag AUTH_PHONE).
 * Registered from MainApplication.onCreate — no impact when not on sign-in screen.
 */
object AuthLifecycleTracer {
  private const val TAG = "AUTH_PHONE"

  @Volatile
  private var registered = false

  @Volatile
  var resumedActivityName: String? = null
    private set

  fun register(app: Application) {
    if (registered) return
    registered = true
    app.registerActivityLifecycleCallbacks(
        object : Application.ActivityLifecycleCallbacks {
          private fun log(event: String, activity: Activity) {
            Log.i(
                TAG,
                "AUTH_ACTIVITY_$event name=${activity.javaClass.name} taskId=${activity.taskId} hash=${activity.hashCode()}"
            )
          }

          override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
            log("CREATED", activity)
            if (activity.javaClass.name.contains("RecaptchaActivity")) {
              Log.i(TAG, "AUTH_RECAPTCHA_ACTIVITY_START")
            }
          }

          override fun onActivityStarted(activity: Activity) = log("STARTED", activity)

          override fun onActivityResumed(activity: Activity) {
            resumedActivityName = activity.javaClass.name
            log("RESUMED", activity)
          }

          override fun onActivityPaused(activity: Activity) {
            if (resumedActivityName == activity.javaClass.name) {
              resumedActivityName = null
            }
            log("PAUSED", activity)
          }

          override fun onActivityStopped(activity: Activity) = log("STOPPED", activity)

          override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

          override fun onActivityDestroyed(activity: Activity) {
            log("DESTROYED", activity)
            if (activity.javaClass.name.contains("RecaptchaActivity")) {
              Log.e(TAG, "AUTH_RECAPTCHA_ACTIVITY_FAIL reason=destroyed")
            }
          }
        }
    )
    Log.i(TAG, "AUTH_LIFECYCLE_TRACER_REGISTERED")
  }
}
