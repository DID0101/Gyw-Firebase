package com.gyw1.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.util.LruCache
import android.util.Log
import android.widget.ImageView
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Lightweight circular avatar load + memory cache for incoming call UI. */
object IncomingCallAvatarLoader {
  private const val TAG = "IncomingCallAvatar"
  private val executor = Executors.newSingleThreadExecutor()
  private val cache = object : LruCache<String, Bitmap>(12) {}

  @JvmStatic
  fun load(
      url: String?,
      imageView: ImageView,
      initialsView: TextView,
      sizePx: Int,
      accentColor: Int,
  ) {
    val trimmed = url?.trim().orEmpty()
    if (trimmed.isEmpty() || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) {
      initialsView.visibility = android.view.View.VISIBLE
      return
    }

    cache.get(trimmed)?.let { cached ->
      imageView.setImageBitmap(cached)
      initialsView.visibility = android.view.View.GONE
      return
    }

    executor.execute {
      try {
        val conn = URL(trimmed).openConnection() as HttpURLConnection
        conn.connectTimeout = 2500
        conn.readTimeout = 2500
        conn.instanceFollowRedirects = true
        conn.inputStream.use { stream ->
          val raw = BitmapFactory.decodeStream(stream) ?: return@execute
          val scaled = scaleCenterCrop(raw, sizePx)
          if (scaled !== raw) raw.recycle()
          val circle = toCircleBitmap(scaled, accentColor)
          scaled.recycle()
          cache.put(trimmed, circle)
          imageView.post {
            imageView.setImageBitmap(circle)
            initialsView.visibility = android.view.View.GONE
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "avatar load failed: ${e.message}")
      }
    }
  }

  private fun scaleCenterCrop(source: Bitmap, sizePx: Int): Bitmap {
    if (source.width == sizePx && source.height == sizePx) return source
    val out = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val scale =
        maxOf(sizePx.toFloat() / source.width, sizePx.toFloat() / source.height)
    val w = source.width * scale
    val h = source.height * scale
    val left = (sizePx - w) / 2f
    val top = (sizePx - h) / 2f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    canvas.drawBitmap(source, null, Rect(left.toInt(), top.toInt(), (left + w).toInt(), (top + h).toInt()), paint)
    return out
  }

  private fun toCircleBitmap(source: Bitmap, borderColor: Int): Bitmap {
    val size = source.width.coerceAtMost(source.height)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val radius = size / 2f
    canvas.drawCircle(radius, radius, radius, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    canvas.drawBitmap(source, 0f, 0f, paint)
    if (borderColor != 0) {
      val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = borderColor
        strokeWidth = (size * 0.02f).coerceAtLeast(2f)
      }
      canvas.drawCircle(radius, radius, radius - stroke.strokeWidth / 2f, stroke)
    }
    return output
  }
}
