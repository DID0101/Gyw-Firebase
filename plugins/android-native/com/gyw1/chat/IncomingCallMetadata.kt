package com.gyw1.chat

import android.content.Intent
import android.util.Log

/**
 * Resolves incoming-call display fields with a strict fallback hierarchy.
 * Never returns blank names for UI.
 */
object IncomingCallMetadata {
  private const val TAG = "IncomingCallMetadata"
  private const val UNKNOWN = "Unknown Caller"
  private val GENERIC =
      setOf(
          "incoming call",
          "unknown",
          "unknown caller",
          "incoming",
          "",
      )

  data class Resolved(
      val callId: String,
      val callerName: String,
      val callerAvatar: String,
      val callerUid: String,
      val callerPhone: String,
      val callType: String,
  )

  @JvmStatic
  fun resolveFromIntent(intent: Intent?): Resolved {
    val safe = intent ?: Intent()
    val callId =
        pick(safe, IncomingCallActivity.EXTRA_CHAT_ID, IncomingCallActivity.EXTRA_CALL_ID)
            .ifBlank { "unknown" }
    val callerUid =
        pick(safe, IncomingCallModule.EXTRA_CALLER_UID, IncomingCallModule.EXTRA_CALLER_ID)
    val callerPhone =
        pick(safe, "callerPhone", "caller_phone")
    val rawName = pick(safe, IncomingCallActivity.EXTRA_CALLER_NAME, "callerName", "caller_name")
    val callerAvatar =
        pick(
            safe,
            IncomingCallActivity.EXTRA_CALLER_AVATAR,
            IncomingCallModule.EXTRA_CALLER_PHOTO_URL,
            "callerAvatar",
            "caller_avatar",
        )
    val callType =
        GywIncomingCallNotifier.normalizeCallType(
            pick(safe, IncomingCallActivity.EXTRA_CALL_TYPE, "callType", "call_type")
                .ifBlank { "audio" })

    val callerName =
        resolveDisplayName(
            callerUid = callerUid,
            callerPhone = callerPhone,
            profileName = rawName,
        )

    Log.w(
        TAG,
        "CALLER_META_ACTIVITY callId=$callId name=$callerName uid=$callerUid phone=${callerPhone.take(6)} avatar=${callerAvatar.take(20)}",
    )

    return Resolved(callId, callerName, callerAvatar, callerUid, callerPhone, callType)
  }

  @JvmStatic
  fun resolveFromFcm(
      callId: String,
      callerUid: String,
      callerPhone: String,
      fcmName: String,
      fcmAvatar: String,
      callType: String,
  ): Resolved {
    val callerName =
        resolveDisplayName(
            callerUid = callerUid,
            callerPhone = callerPhone,
            profileName = fcmName,
        )
    Log.w(
        TAG,
        "CALLER_META_PAYLOAD callId=$callId name=$callerName uid=$callerUid phone=${callerPhone.take(6)}",
    )
    return Resolved(
        callId,
        callerName,
        fcmAvatar.trim(),
        callerUid.trim(),
        callerPhone.trim(),
        GywIncomingCallNotifier.normalizeCallType(callType),
    )
  }

  @JvmStatic
  fun resolveDisplayName(
      callerUid: String,
      callerPhone: String,
      profileName: String,
  ): String {
    val cached = CallerProfileCache.getProfile(callerUid)
    if (cached != null && !isGeneric(cached.name)) {
      Log.d(TAG, "CALLER_META_RENDERED source=uid_cache")
      return cached.name
    }

    val fromContacts = ContactNameCache.resolveDisplayName(callerPhone, profileName)
    if (!isGeneric(fromContacts)) {
      Log.d(TAG, "CALLER_META_RENDERED source=contact_or_profile")
      return fromContacts
    }

    val profile = profileName.trim()
    if (!isGeneric(profile)) {
      Log.d(TAG, "CALLER_META_RENDERED source=fcm_profile")
      return profile
    }

    val phone = callerPhone.trim()
    if (phone.isNotEmpty()) {
      Log.d(TAG, "CALLER_META_RENDERED source=phone")
      return phone
    }

    if (cached != null && cached.name.isNotBlank()) {
      return cached.name
    }

    Log.d(TAG, "CALLER_META_RENDERED source=fallback")
    return UNKNOWN
  }

  private fun isGeneric(name: String): Boolean = GENERIC.contains(name.trim().lowercase())

  private fun pick(intent: Intent, vararg keys: String): String {
    for (key in keys) {
      val v = intent.getStringExtra(key)?.trim().orEmpty()
      if (v.isNotEmpty()) return v
    }
    return ""
  }
}
