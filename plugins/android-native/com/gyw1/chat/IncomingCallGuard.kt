package com.gyw1.chat

import android.content.Context
import android.util.Log

/**
 * Process-wide incoming-call dedupe lock.
 *
 * First trigger for callId wins; duplicates for the same callId inside the window are ignored.
 * After callee accepts, [markAnswered] blocks all re-triggers (FCM, OEM retries, Firestore echo).
 */
object IncomingCallGuard {
  private const val TAG = "IncomingCallGuard"
  private const val PREFS = "gyw_incoming_call_guard"
  private const val KEY_ENTRIES = "entries"
  private const val KEY_ANSWERED = "answered"
  private const val WINDOW_MS = 60_000L

  @JvmStatic
  @Synchronized
  fun tryAcquire(context: Context, callId: String, source: String): Boolean {
    val now = System.currentTimeMillis()
    if (isAnswered(context, callId)) {
      Log.d(
        TAG,
        "INCOMING_UI_BLOCKED source=$source callId=$callId reason=answered ts=$now"
      )
      return false
    }
    val app = context.applicationContext
    val map = loadEntries(app).filterValues { ts -> now - ts <= WINDOW_MS }.toMutableMap()
    val existingTs = map[callId]
    val allowed = existingTs == null

    if (allowed) {
      map[callId] = now
      saveEntries(app, map)
    }

    Log.d(
      TAG,
      "INCOMING_TRIGGER source=$source callId=$callId ts=$now allowed=$allowed duplicate=${!allowed}"
    )
    return allowed
  }

  @JvmStatic
  @Synchronized
  fun isLocked(context: Context, callId: String): Boolean {
    val now = System.currentTimeMillis()
    val map = loadEntries(context.applicationContext)
    val ts = map[callId] ?: return false
    return now - ts <= WINDOW_MS
  }

  /** Callee accepted — block FCM / OEM retries / notifier from reopening incoming UI. */
  @JvmStatic
  @Synchronized
  fun markAnswered(context: Context, callId: String?, reason: String) {
    if (callId.isNullOrBlank()) return
    val app = context.applicationContext
    val answered = loadAnswered(app).toMutableSet()
    answered.add(callId)
    saveAnswered(app, answered)
    val map = loadEntries(app).toMutableMap()
    map.remove(callId)
    saveEntries(app, map)
    Log.d(
      TAG,
      "INCOMING_UI_BLOCKED callId=$callId reason=$reason action=markAnswered ts=${System.currentTimeMillis()}"
    )
  }

  @JvmStatic
  @Synchronized
  fun isAnswered(context: Context, callId: String): Boolean {
    return loadAnswered(context.applicationContext).contains(callId)
  }

  @JvmStatic
  @Synchronized
  fun release(context: Context, callId: String?, reason: String) {
    if (callId.isNullOrBlank()) return
    val app = context.applicationContext
    val map = loadEntries(app).toMutableMap()
    val removed = map.remove(callId) != null
    saveEntries(app, map)
    Log.d(
      TAG,
      "INCOMING_TRIGGER_RELEASE callId=$callId reason=$reason removed=$removed ts=${System.currentTimeMillis()}"
    )
  }

  @JvmStatic
  @Synchronized
  fun clearAnswered(context: Context, callId: String?) {
    if (callId.isNullOrBlank()) return
    val app = context.applicationContext
    val answered = loadAnswered(app).toMutableSet()
    if (answered.remove(callId)) {
      saveAnswered(app, answered)
      Log.d(TAG, "INCOMING_ANSWERED_CLEAR callId=$callId")
    }
  }

  private fun loadEntries(context: Context): MutableMap<String, Long> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_ENTRIES, "") ?: ""
    val out = mutableMapOf<String, Long>()
    if (raw.isBlank()) return out
    raw.split(";").forEach { token ->
      val idx = token.indexOf(':')
      if (idx <= 0) return@forEach
      val callId = token.substring(0, idx)
      val ts = token.substring(idx + 1).toLongOrNull() ?: return@forEach
      out[callId] = ts
    }
    return out
  }

  private fun saveEntries(context: Context, entries: Map<String, Long>) {
    val serialized = entries.entries.joinToString(";") { "${it.key}:${it.value}" }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ENTRIES, serialized)
      .apply()
  }

  private fun loadAnswered(context: Context): MutableSet<String> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_ANSWERED, "") ?: ""
    if (raw.isBlank()) return mutableSetOf()
    return raw.split(";").filter { it.isNotBlank() }.toMutableSet()
  }

  private fun saveAnswered(context: Context, answered: Set<String>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_ANSWERED, answered.joinToString(";"))
      .apply()
  }
}
