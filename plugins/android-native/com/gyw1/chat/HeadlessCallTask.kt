package com.gyw1.chat

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * HeadlessCallTask
 *
 * A React Native HeadlessJsTaskService that wakes the JS engine (even when the
 * app is completely killed) and dispatches a "GywCallHeadlessTask" headless task.
 *
 * ── When it runs ────────────────────────────────────────────────────────────
 *   GywFirebaseMessagingService starts this service for every INCOMING_CALL or
 *   CALL_CANCELLED FCM message when the app is in the background or killed state.
 *   The task has a 30-second timeout to update Firestore, cache call state, etc.
 *
 * ── JS registration (index.js) ──────────────────────────────────────────────
 *   import { AppRegistry } from 'react-native';
 *
 *   AppRegistry.registerHeadlessTask(
 *     'GywCallHeadlessTask',
 *     () => async (taskData) => {
 *       const { type, callId, callerId, callerName, callType } = taskData;
 *       if (type === 'INCOMING_CALL') {
 *         // Update local cache, schedule missed-call notification, etc.
 *         // Do NOT navigate — there is no UI in headless mode.
 *       }
 *       if (type === 'CALL_CANCELLED') {
 *         await cancelMissedCallNotification(callId);
 *       }
 *     }
 *   );
 *
 * ── AndroidManifest.xml ─────────────────────────────────────────────────────
 *   <service
 *     android:name=".HeadlessCallTask"
 *     android:exported="false" />
 *
 * ── Starting the service ────────────────────────────────────────────────────
 *   Use HeadlessCallTask.start(context, bundle) — the static helper acquires
 *   the HeadlessJsTaskService WakeLock and starts the service normally.
 *   This service is NOT a foreground service and does not call startForeground().
 */
class HeadlessCallTask : HeadlessJsTaskService() {

  companion object {
    private const val TAG           = "GywHeadlessCallTask"
    /** Must match AppRegistry.registerHeadlessTask key in index.js */
    const val TASK_NAME             = "GywCallHeadlessTask"
    /** Maximum time JS has to complete the task before it is force-killed. */
    private const val TIMEOUT_MS    = 30_000L
    /** Allow the task to run even when the app is in the foreground. */
    private const val ALLOW_IN_FG   = true

    // ── Extra keys — mirror GywFirebaseMessagingService data keys ──────────

    const val EXTRA_TYPE          = "type"
    const val EXTRA_CALL_ID       = "callId"
    const val EXTRA_CALLER_ID     = "callerId"
    const val EXTRA_CALLER_NAME   = "callerName"
    const val EXTRA_CALLER_AVATAR = "callerAvatar"
    const val EXTRA_CALL_TYPE     = "callType"

    /**
     * Start HeadlessCallTask from GywFirebaseMessagingService.
     *
     * Must be called from within [FirebaseMessagingService.onMessageReceived]
     * so we are still inside the FCM-allowed background-start window.
     * Acquires the HeadlessJsTaskService WakeLock automatically.
     */
    fun start(context: Context, data: Map<String, String>) {
      val app    = context.applicationContext
      val bundle = Bundle().apply {
        data.forEach { (k, v) -> putString(k, v) }
      }
      val intent = Intent(app, HeadlessCallTask::class.java).apply {
        putExtras(bundle)
      }

      try {
        // acquireWakeLockNow keeps the CPU alive until HeadlessJsTaskService
        // releases it after the task finishes (or times out).
        HeadlessJsTaskService.acquireWakeLockNow(app)
        // HeadlessJsTaskService is not a foreground service. Starting it with
        // startForegroundService() forces a startForeground() call within ~10s
        // and crashes with ForegroundServiceDidNotStartInTimeException.
        app.startService(intent)
        Log.d(TAG, "HeadlessCallTask started type=${data["type"]} callId=${data["callId"]}")
      } catch (e: IllegalStateException) {
        // Android 12+ background-start restriction — only thrown if called
        // outside the FCM callback window (should not happen in practice).
        Log.e(TAG, "startForegroundService failed — called outside FCM window? ${e.message}")
      } catch (e: Exception) {
        Log.e(TAG, "HeadlessCallTask.start error: ${e.message}")
      }
    }
  }

  // ── HeadlessJsTaskService ─────────────────────────────────────────────────

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras
    if (extras == null) {
      Log.w(TAG, "getTaskConfig: null extras — aborting")
      return null
    }

    // Convert Bundle → WritableMap (the shape JS receives as taskData)
    val taskData = Arguments.createMap().apply {
      for (key in extras.keySet()) {
        when (val v = extras.get(key)) {
          is String  -> putString(key, v)
          is Int     -> putInt(key, v)
          is Boolean -> putBoolean(key, v)
          is Double  -> putDouble(key, v)
          is Long    -> putDouble(key, v.toDouble())
          else       -> putString(key, v?.toString() ?: "")
        }
      }
    }

    val callId = extras.getString(EXTRA_CALL_ID, "?")
    val type   = extras.getString(EXTRA_TYPE, "?")
    Log.d(TAG, "getTaskConfig type=$type callId=$callId")

    return HeadlessJsTaskConfig(
      TASK_NAME,    // registered task name in AppRegistry
      taskData,     // passed as first arg to the JS handler
      TIMEOUT_MS,   // force-kill timeout
      ALLOW_IN_FG   // run even when React UI is visible
    )
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    super.onHeadlessJsTaskFinish(taskId)
    Log.d(TAG, "headless task finished id=$taskId")
  }
}
