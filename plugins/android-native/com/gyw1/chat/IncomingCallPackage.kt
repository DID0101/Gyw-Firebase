package com.gyw1.chat

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers incoming-call native modules for React Native.
 */
class IncomingCallPackage : ReactPackage {
  override fun createNativeModules(
      reactContext: ReactApplicationContext
  ): List<NativeModule> {
    return listOf(
        IncomingCallModule(reactContext),
        IncomingCallBridgeModule(reactContext),
        ChatNotificationBridgeModule(reactContext),
    )
  }

  override fun createViewManagers(
      reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> {
    return emptyList()
  }
}
