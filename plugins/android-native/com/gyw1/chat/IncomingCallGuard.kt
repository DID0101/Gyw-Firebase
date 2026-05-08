package com.gyw1.chat

import android.content.Context
import android.util.Log

/**
 * Process-wide incoming-call dedupe lock.
 *
 * First trigger for callId wins; duplicates for the same callId inside the window are ignored.
 */
object IncomingCallGuard {
  private const val TAG = "IncomingCallGuard"
  private const val PREFS = "gyw_incoming_call_guard"
  private const val KEY_ENTRIES = "entries"
  private const val WINDOW_MS = 60_000L

  @JvmStatic
  @Synchronized
  fun tryAcquire(context: Context, callId: String, source: String): Boolean {
    val now = System.currentTimeMillis()
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
}
