package com.gyw1.chat

import android.util.Log
import java.util.concurrent.ConcurrentHashMap

/**
 * On-device phone → local contact name cache (populated from JS after expo-contacts scan).
 * Used for incoming call / message notifications when React is not running.
 */
object ContactNameCache {
  private const val TAG = "ContactNameCache"
  private val phoneToName = ConcurrentHashMap<String, String>()

  @JvmStatic
  fun setMap(entries: Map<String, String>) {
    phoneToName.clear()
    for ((k, v) in entries) {
      val key = k.trim()
      val name = v.trim()
      if (key.isNotEmpty() && name.isNotEmpty()) {
        phoneToName[key] = name
      }
    }
    Log.d(TAG, "CONTACTS_CACHE_READY count=${phoneToName.size}")
  }

  @JvmStatic
  fun resolveDisplayName(phone: String?, profileFallback: String): String {
    val local = resolveLocalName(phone)
    if (!local.isNullOrBlank()) {
      Log.d(TAG, "CONTACT_RESOLVED source=local_contact")
      return local
    }
    val profile = profileFallback.trim()
    if (profile.isNotEmpty() && !profile.equals("Incoming call", ignoreCase = true)) {
      Log.d(TAG, "CONTACT_RESOLVED source=profile")
      return profile
    }
    if (!phone.isNullOrBlank()) {
      Log.d(TAG, "CONTACT_RESOLVED source=phone")
      return phone.trim()
    }
    Log.d(TAG, "CONTACT_LOOKUP_MISS")
    return if (profile.isNotEmpty()) profile else "Unknown Caller"
  }

  @JvmStatic
  fun resolveLocalName(phone: String?): String? {
    if (phone.isNullOrBlank()) return null
    val raw = phone.trim()
    val keys = linkedSetOf<String>()
    keys.add(raw)
    val digits = raw.replace(Regex("\\D"), "")
    if (digits.length >= 7) keys.add(digits)
    if (raw.startsWith("+")) keys.add(raw.substring(1))
    if (!raw.startsWith("+") && digits.length >= 10) keys.add("+$digits")
    for (key in keys) {
      val hit = phoneToName[key]
      if (!hit.isNullOrBlank()) return hit
    }
    Log.d(TAG, "CONTACT_LOOKUP_MISS phone=${raw.take(6)}…")
    return null
  }
}
