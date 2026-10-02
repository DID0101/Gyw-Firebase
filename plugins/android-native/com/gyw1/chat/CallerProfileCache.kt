package com.gyw1.chat

import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * UID → caller display metadata for killed-state incoming call UI.
 * Populated from JS (recent chats / call participants) — never uploaded.
 */
object CallerProfileCache {
  private const val TAG = "CallerProfileCache"

  data class Profile(
      val name: String,
      val avatar: String = "",
      val phone: String = "",
  )

  private val byUid = ConcurrentHashMap<String, Profile>()

  @JvmStatic
  fun setProfile(uid: String, name: String, avatar: String = "", phone: String = "") {
    val id = uid.trim()
    val n = name.trim()
    if (id.isEmpty() || n.isEmpty()) return
    byUid[id] = Profile(n, avatar.trim(), phone.trim())
  }

  @JvmStatic
  fun setProfiles(entries: Map<String, Profile>) {
    byUid.clear()
    for ((uid, p) in entries) {
      val id = uid.trim()
      val n = p.name.trim()
      if (id.isNotEmpty() && n.isNotEmpty()) {
        byUid[id] = p
      }
    }
    Log.d(TAG, "CALLER_PROFILE_CACHE_READY count=${byUid.size}")
  }

  @JvmStatic
  fun getProfile(uid: String?): Profile? {
    if (uid.isNullOrBlank()) return null
    return byUid[uid.trim()]
  }
}
