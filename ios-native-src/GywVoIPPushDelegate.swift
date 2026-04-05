/**
 * GywVoIPPushDelegate.swift
 *
 * PushKit handler for iOS VoIP push notifications.
 *
 * WHY THIS EXISTS:
 * - Regular APNs / FCM notifications are throttled/suppressed by iOS when the app is killed.
 * - PushKit (PKPushRegistry with VoIP type) wakes the app immediately and gives it ~30 seconds
 *   to report an incoming call via CallKit, even from a killed state.
 * - Apple policy (iOS 13+): every VoIP push MUST result in a CXProvider.reportNewIncomingCall() call,
 *   otherwise the app is terminated and banned from VoIP pushes. We use react-native-callkeep which
 *   wraps CXProvider, so that requirement is met here.
 *
 * PLACEMENT:
 * Run `expo prebuild --platform ios`, then copy this file into `ios/<AppName>/`.
 * Register it in AppDelegate.swift (see instructions below).
 *
 * HOW TO REGISTER IN AppDelegate.swift:
 *
 *   import PushKit
 *
 *   // inside application(_:didFinishLaunchingWithOptions:)
 *   GywVoIPPushDelegate.shared.register()
 *
 * The delegate forwards the push payload to react-native-callkeep which calls
 * CXProvider.reportNewIncomingCall(). Once the RN bridge loads, the JS CallKeep
 * `answerCall` / `endCall` listeners take over.
 */

import Foundation
import PushKit
import CallKit

@objc public class GywVoIPPushDelegate: NSObject, PKPushRegistryDelegate {

  @objc public static let shared = GywVoIPPushDelegate()
  private var registry: PKPushRegistry?

  @objc public func register() {
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    self.registry = registry
  }

  // MARK: - PKPushRegistryDelegate

  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
    NSLog("[GywVoIP] VoIP push token: \(token.suffix(12))…")
    // Persist the token to Firestore via RNFirebase from JS (bridge may not be ready here).
    // Store it in UserDefaults; JS reads it on launch via a native module or react-native-callkeep.
    UserDefaults.standard.set(token, forKey: "GywVoIPPushToken")
    UserDefaults.standard.synchronize()
    // react-native-callkeep also listens for this via RNCallKeep.didLoadWithEvents — no extra
    // wiring needed as long as the bundle identifier entitlement is correct.
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    NSLog("[GywVoIP] VoIP push token invalidated")
    UserDefaults.standard.removeObject(forKey: "GywVoIPPushToken")
  }

  /**
   * THE CRITICAL METHOD — called even when the app is fully killed.
   *
   * Apple requirement (iOS 13+): MUST call CXProvider.reportNewIncomingCall before returning.
   * react-native-callkeep's `displayIncomingCall` calls CXProvider internally.
   *
   * We call RNCallKeep directly (bypassing JS) so the system call UI appears instantly,
   * before the JS bridge has loaded.
   */
  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else { completion(); return }

    let data = payload.dictionaryPayload
    guard
      let callId   = data["callId"]     as? String, !callId.isEmpty,
      let callerId = data["callerId"]   as? String
    else {
      // MUST still report a call or iOS terminates the app.
      reportFakeCallToSatisfyApplePolicy()
      completion()
      return
    }

    let callerName = (data["callerName"] as? String) ?? callerId
    let hasVideo   = (data["callType"]   as? String) == "video"

    NSLog("[GywVoIP] Incoming call callId=\(callId) caller=\(callerName) video=\(hasVideo)")

    // Store for JS to read after the bridge loads.
    let prefs = UserDefaults.standard
    prefs.set(callId,     forKey: "GywPendingCallId")
    prefs.set(callerId,   forKey: "GywPendingCallerId")
    prefs.set(callerName, forKey: "GywPendingCallerName")
    prefs.set(hasVideo ? "video" : "audio", forKey: "GywPendingCallType")
    prefs.set(Date().timeIntervalSince1970 * 1000, forKey: "GywPendingCallAt")
    prefs.synchronize()

    // Report to CallKit via react-native-callkeep's RNCallKeep class.
    // This shows the system full-screen call UI before JS loads.
    let uuid = UUID()
    let callUpdate = CXCallUpdate()
    callUpdate.remoteHandle = CXHandle(type: .generic, value: callerName)
    callUpdate.hasVideo = hasVideo
    callUpdate.localizedCallerName = callerName
    callUpdate.supportsHolding = false
    callUpdate.supportsGrouping = false
    callUpdate.supportsUngrouping = false
    callUpdate.supportsDTMF = false

    let provider = GywCallKitProvider.shared.provider
    provider.reportNewIncomingCall(with: uuid, update: callUpdate) { [weak self] error in
      if let error = error {
        NSLog("[GywVoIP] reportNewIncomingCall error: \(error)")
      } else {
        NSLog("[GywVoIP] reportNewIncomingCall succeeded uuid=\(uuid)")
        // Store uuid↔callId mapping so JS CallKeep listeners can resolve them.
        UserDefaults.standard.set(uuid.uuidString, forKey: "GywPendingCallUUID")
        UserDefaults.standard.synchronize()
      }
      completion()
    }
  }

  private func reportFakeCallToSatisfyApplePolicy() {
    // Apple requires reportNewIncomingCall even for invalid pushes.
    let uuid = UUID()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: "Unknown")
    GywCallKitProvider.shared.provider.reportNewIncomingCall(with: uuid, update: update) { _ in
      // Immediately end the fake call.
      let controller = CXCallController()
      let endAction = CXEndCallAction(call: uuid)
      let transaction = CXTransaction(action: endAction)
      controller.request(transaction) { _ in }
    }
  }
}
