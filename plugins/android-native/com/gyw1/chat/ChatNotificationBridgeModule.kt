package com.gyw1.chat

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** React Native bridge for chat message notifications — separate from IncomingCallBridge (calls). */
class ChatNotificationBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /** When this chat is focused, native FCM will suppress message notifications for that chatId. */
  @ReactMethod
  fun setForegroundChatId(chatId: String?) {
    GywMessageNotifier.setForegroundChatId(reactContext, chatId)
  }

  @ReactMethod
  fun setChatUnreadTotal(total: Int, promise: Promise) {
    try {
      GywMessageNotifier.setChatUnreadTotal(reactContext, total)
      promise.resolve(null)
    } catch (e: Exception) {
      Log.w(NAME, "setChatUnreadTotal: ${e.message}")
      promise.reject("E_CHAT_BADGE", e.message, e)
    }
  }

  @ReactMethod
  fun clearChatNotifications(chatId: String, promise: Promise) {
    try {
      GywMessageNotifier.cancelForChat(reactContext, chatId)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CHAT_NOTIF", e.message, e)
    }
  }

  /** Returns JSON string from inline reply (then clears), or null. */
  @ReactMethod
  fun consumePendingReplyJson(promise: Promise) {
    try {
      promise.resolve(GywMessageNotifier.consumePendingReplyJson(reactContext))
    } catch (e: Exception) {
      promise.reject("E_CHAT_REPLY", e.message, e)
    }
  }

  companion object {
    private const val NAME = "ChatNotificationBridge"
  }
}
