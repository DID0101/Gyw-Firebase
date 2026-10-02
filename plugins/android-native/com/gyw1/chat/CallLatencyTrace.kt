package com.gyw1.chat

import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * Native call latency markers — same tags as lib/perf/callLatencyTrace.ts.
 * Filter: adb logcat | grep CALL_LATENCY
 */
object CallLatencyTrace {
  private const val TAG = "CallLatencyTrace"

  private val t0ByCall = ConcurrentHashMap<String, Long>()
  private val marked = ConcurrentHashMap<String, MutableSet<String>>()

  @JvmStatic
  fun start(callId: String, tag: String = "CALL_START_T0", epochMs: Long = System.currentTimeMillis()) {
    if (callId.isBlank()) return
    t0ByCall[callId] = epochMs
    marked[callId] = ConcurrentHashMap.newKeySet<String>().apply { add(tag) }
    log(callId, tag, epochMs, epochMs)
  }

  @JvmStatic
  @JvmOverloads
  fun mark(callId: String, tag: String, extra: String? = null) {
    if (callId.isBlank()) return
    val now = System.currentTimeMillis()
    val t0 = t0ByCall.getOrPut(callId) { now }
    val set = marked.getOrPut(callId) { ConcurrentHashMap.newKeySet() }
    if (!set.add(tag)) return
    log(callId, tag, t0, now, extra)
  }

  @JvmStatic
  fun clear(callId: String) {
    if (callId.isBlank()) return
    t0ByCall.remove(callId)
    marked.remove(callId)
  }

  private fun log(callId: String, tag: String, t0: Long, now: Long, extra: String? = null) {
    val ms = now - t0
    val extraStr = if (extra.isNullOrBlank()) "" else " $extra"
    Log.i(TAG, "CALL_LATENCY callId=$callId tag=$tag ms=$ms$extraStr")
  }
}
