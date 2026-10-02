package com.gyw1.chat

import android.graphics.Color

/** WhatsApp / Signal inspired palette for native incoming call UI. */
object IncomingCallUiTheme {
  const val BG_TOP = "#0B141A"
  const val BG_BOTTOM = "#111B21"
  const val TEXT_PRIMARY = "#FFFFFF"
  const val TEXT_SECONDARY = "#8696A0"
  const val TEXT_MUTED = "#667781"
  const val ENCRYPTED = "#8696A0"

  const val AUDIO_ACCENT = "#25D366"
  const val AUDIO_ACCENT_DIM = "#1DA851"
  const val VIDEO_ACCENT = "#0086FF"
  const val VIDEO_ACCENT_DIM = "#0070D4"

  const val DECLINE = "#F15C6D"
  const val DECLINE_PRESSED = "#D14958"

  const val AVATAR_RING_AUDIO = "#25D366"
  const val AVATAR_RING_VIDEO = "#0086FF"
  const val AVATAR_FALLBACK_AUDIO = "#1F2C34"
  const val AVATAR_FALLBACK_VIDEO = "#0D2137"

  fun initialsBackground(isVideo: Boolean): Int =
      Color.parseColor(if (isVideo) AVATAR_FALLBACK_VIDEO else AVATAR_FALLBACK_AUDIO)

  fun accent(isVideo: Boolean): Int =
      Color.parseColor(if (isVideo) VIDEO_ACCENT else AUDIO_ACCENT)

  fun accentDim(isVideo: Boolean): Int =
      Color.parseColor(if (isVideo) VIDEO_ACCENT_DIM else AUDIO_ACCENT_DIM)

  fun avatarRing(isVideo: Boolean): Int =
      Color.parseColor(if (isVideo) AVATAR_RING_VIDEO else AVATAR_RING_AUDIO)
}
