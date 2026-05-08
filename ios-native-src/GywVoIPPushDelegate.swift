/**
 * GywVoIPPushDelegate.swift
 *
 * Single-file implementation of PushKit + CallKit for VoIP incoming calls.
 *
 * Placement after `expo prebuild`:
 *   ios/<AppName>/GywVoIPPushDelegate.swift
 *
 * The Expo config plugin (plugins/withIosVoIP.js) copies this file automatically.
 *
 * ── Critical Apple rule ───────────────────────────────────────────────────────
 * provider.reportNewIncomingCall(with:update:completion:) MUST be called
 * synchronously within the pushRegistry(_:didReceiveIncomingPushWith:for:completion:)
 * call stack.  If the app returns from that method without having called
 * reportNewIncomingCall (or at least a dummy one), iOS kills the process.
 * The completion: parameter must also be called after reportNewIncomingCall's
 * own completion fires — never before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import CallKit
import Foundation
import PushKit
import React
import UIKit

// MARK: - Notification names (internal IPC)

extension Notification.Name {
  /// Posted when PushKit delivers a fresh VoIP token.
  /// userInfo["voipToken"] = hex string
  static let gywVoIPToken = Notification.Name("GywVoIPToken")
}

// MARK: - GywVoIPPushDelegate

@objc(GywVoIPPushDelegate)
public final class GywVoIPPushDelegate: NSObject {

  // ── Singleton ─────────────────────────────────────────────────────────────

  @objc public static let shared = GywVoIPPushDelegate()

  // ── Private state ─────────────────────────────────────────────────────────

  /// UUID given to CallKit for the most recent incoming call.
  private var pendingCallUUID: UUID?
  /// The Firestore call document ID that corresponds to pendingCallUUID.
  private var pendingCallId: String?
  /// Set to true once setup() runs so it is idempotent.
  private var isSetUp = false

  private let provider: CXProvider
  private let callController = CXCallController()
  private var registry: PKPushRegistry?

  // ── Init ──────────────────────────────────────────────────────────────────

  private override init() {
    // CXProviderConfiguration — customise these for your app.
    let cfg = CXProviderConfiguration()
    cfg.localizedName           = "GYW"
    cfg.supportsVideo           = true
    cfg.maximumCallsPerCallGroup = 1
    cfg.maximumCallGroups       = 1
    cfg.supportedHandleTypes    = [.generic]
    cfg.includesCallsInRecents  = false
    // Uncomment to use a custom ringtone (add .caf file to Xcode target):
    // cfg.ringtoneSound = "ringtone.caf"
    // Uncomment to show a custom icon in the CallKit UI:
    // cfg.iconTemplateImageData = UIImage(named: "CallKitIcon")?.pngData()

    provider = CXProvider(configuration: cfg)
    super.init()
    // Deliver CXProvider events on the main queue so UIKit calls are safe.
    provider.setDelegate(self, queue: .main)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /// Call once from AppDelegate.didFinishLaunchingWithOptions (after super).
  /// Safe to call multiple times — idempotent.
  @objc public func setup() {
    guard !isSetUp else { return }
    isSetUp = true
    let reg = PKPushRegistry(queue: .main)
    reg.delegate = self
    reg.desiredPushTypes = [.voIP]
    registry = reg   // retain
    print("[GywVoIP] PushKit registry started")
  }

  /// Called by the JS call screen when the WebRTC session ends normally.
  /// Tells CallKit the call is over so its UI is dismissed cleanly.
  @objc public func reportCallEnded(callId: String) {
    guard let uuid = pendingCallUUID, pendingCallId == callId else { return }
    provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
    pendingCallUUID = nil
    pendingCallId   = nil
    print("[GywVoIP] reportCallEnded:", callId)
  }

  /// Convenience wrapper for JS / RNCallKeep interop.
  @objc public func endCallWithUUID(_ uuidString: String) {
    guard let uuid = UUID(uuidString: uuidString) else { return }
    let action    = CXEndCallAction(call: uuid)
    let txn       = CXTransaction(action: action)
    callController.request(txn) { error in
      if let error = error {
        print("[GywVoIP] endCallWithUUID error:", error.localizedDescription)
      }
    }
  }
}

// MARK: - PKPushRegistryDelegate

extension GywVoIPPushDelegate: PKPushRegistryDelegate {

  // ── Token registration ────────────────────────────────────────────────────

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate credentials: PKPushCredentials,
    for type: PKPushType
  ) {
    guard type == .voIP else { return }

    // Convert raw bytes → lowercase hex string (standard APNs token format)
    let token = credentials.token
      .map { String(format: "%02hhx", $0) }
      .joined()

    print("[GywVoIP] VoIP token registered (prefix):", String(token.prefix(12)), "…")

    // ── Persist token for the JS layer ────────────────────────────────────────
    //
    // Strategy A: UserDefaults — readable by JS via RCTSharedApplication /
    //   NativeModules.SettingsManager (SettingsManager.settings["gyw_voip_token"]).
    //   This is the most reliable cross-process store on iOS.
    UserDefaults.standard.set(token, forKey: "gyw_voip_token")
    UserDefaults.standard.synchronize()

    // Strategy B: React Native AsyncStorage (file-based, same sandbox).
    //   We write via the shared RCTAsyncLocalStorage module if it is loaded.
    //   This is the fallback path that fcmTokenService.ts reads directly.
    _saveVoipTokenToAsyncStorage(token)

    // ── Forward to react-native-voip-push-notification ───────────────────────
    // That package fires a JS 'register' event which fcmTokenService listens for.
    if let rnVoip = NSClassFromString("RNVoipPushNotificationManager") as? NSObject.Type,
       rnVoip.responds(to: NSSelectorFromString("didUpdatePushCredentials:forType:")) {
      let sel = NSSelectorFromString("didUpdatePushCredentials:forType:")
      _ = rnVoip.perform(sel, with: credentials, with: type.rawValue)
    }

    // Also post via NotificationCenter so other native listeners can observe it.
    NotificationCenter.default.post(
      name:     .gywVoIPToken,
      object:   nil,
      userInfo: ["voipToken": token]
    )
  }

  // MARK: - Private: AsyncStorage write helper

  /// Writes the VoIP token directly into React Native's AsyncStorage file so
  /// `fcmTokenService.ts` can read it with `AsyncStorage.getItem('gyw_voip_token')`
  /// even before react-native-voip-push-notification fires its JS event.
  ///
  /// RN AsyncStorage v2 stores data as a JSON manifest at:
  ///   <Documents>/RCTAsyncLocalStorage_V1/<hash>.json  (old)
  ///   <Library>/Application Support/RCTAsyncLocalStorage/<hash>.json  (new)
  ///
  /// Rather than parsing that format ourselves, we use the public
  /// RCTAsyncStorageDataStore API if it is available in the running binary.
  private func _saveVoipTokenToAsyncStorage(_ token: String) {
    // RCTAsyncStorageDataStore is part of @react-native-async-storage/async-storage.
    // It may not be loaded at the time PushKit fires (app killed).
    // We use NSClassFromString + performSelector to avoid a hard link dependency.
    let storeName = "RCTAsyncStorageDataStore"
    guard let cls = NSClassFromString(storeName) as? NSObject.Type else {
      // Module not yet loaded — the UserDefaults path above is the fallback.
      return
    }

    let storeSelector = NSSelectorFromString("shared")
    guard cls.responds(to: storeSelector) else { return }
    guard let store = cls.perform(storeSelector)?.takeUnretainedValue() as? NSObject else { return }

    let setSelector = NSSelectorFromString("setObject:forKey:")
    guard store.responds(to: setSelector) else { return }

    // The key must be stored exactly as AsyncStorage encodes it: plain string key.
    store.perform(setSelector, with: token, with: "gyw_voip_token")
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    guard type == .voIP else { return }
    print("[GywVoIP] VoIP push token invalidated — will re-register on next launch")
  }

  // ── Incoming push ─────────────────────────────────────────────────────────
  //
  // ⚠️  APPLE REQUIREMENT (enforced since iOS 13):
  //   reportNewIncomingCall must be called synchronously before this method
  //   returns.  Calling it in a DispatchQueue.async or after an await will
  //   cause iOS to kill the app with error "application crashed because it
  //   called PKPushRegistryDelegate method and did not report an incoming call
  //   within the same call stack."
  //
  //   Even if the payload is malformed, you must still call reportNewIncomingCall
  //   and then immediately end the dummy call (see reportDummyCallAndFinish).

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else { completion(); return }

    let dict = payload.dictionaryPayload

    // Forward raw payload to react-native-voip-push-notification if installed
    // (delivers the 'notification' event to JS so the app can update state).
    if let rnVoip = NSClassFromString("RNVoipPushNotificationManager") as? NSObject.Type,
       rnVoip.responds(to: NSSelectorFromString("didReceiveIncomingPushWithPayload:forType:withCompletionHandler:")) {
      let sel = NSSelectorFromString("didReceiveIncomingPushWithPayload:forType:withCompletionHandler:")
      // Use performSelector carefully — only for interop, not critical path
      _ = rnVoip.perform(sel, with: payload, with: type.rawValue)
    }

    // ── Validate payload ──────────────────────────────────────────────────
    guard
      let callId     = dict["callId"]     as? String, !callId.isEmpty,
      let callerName = dict["callerName"] as? String, !callerName.isEmpty
    else {
      print("[GywVoIP] ⚠️  VoIP push missing callId/callerName — reporting dummy call to satisfy Apple")
      // MUST still call reportNewIncomingCall, then immediately end it
      reportDummyCallAndFinish(completion: completion)
      return
    }

    let callType = dict["callType"] as? String ?? "audio"
    print("[GywVoIP] Incoming call → callId=\(callId)  caller=\(callerName)  type=\(callType)")

    // ── Report to CallKit (synchronous path — within this call stack) ──────
    reportToCallKit(
      callId:     callId,
      callerName: callerName,
      isVideo:    callType == "video",
      completion: completion
    )
  }

  // MARK: Private helpers

  /// Synchronously reports a new incoming call to CallKit and calls completion
  /// inside CallKit's own callback (satisfying Apple's requirement).
  private func reportToCallKit(
    callId:     String,
    callerName: String,
    isVideo:    Bool,
    completion: @escaping () -> Void
  ) {
    let uuid = UUID()
    pendingCallUUID = uuid
    pendingCallId   = callId

    let update                   = CXCallUpdate()
    update.remoteHandle          = CXHandle(type: .generic, value: callerName)
    update.hasVideo              = isVideo
    update.localizedCallerName   = isVideo
      ? "\(callerName) · Video"
      : "\(callerName) · Voice"
    update.supportsDTMF          = false
    update.supportsHolding       = false
    update.supportsGrouping      = false
    update.supportsUngrouping    = false

    // reportNewIncomingCall is called HERE — synchronously within
    // pushRegistry(_:didReceiveIncomingPushWith:for:completion:)
    provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
      if let error = error {
        // Common errors:
        //   CXErrorCodeIncomingCallError.filteredByDoNotDisturb  — DND active
        //   CXErrorCodeIncomingCallError.filteredByBlockList      — caller blocked
        //   CXErrorCodeIncomingCallError.unentitled               — missing entitlement
        print("[GywVoIP] reportNewIncomingCall error:", error.localizedDescription)
        self?.pendingCallUUID = nil
        self?.pendingCallId   = nil
      }
      // PushKit completion MUST be called after reportNewIncomingCall's own
      // completion, never before — calling it earlier risks app termination.
      completion()
    }
  }

  /// Used when the payload is malformed.  Apple still requires a call be
  /// reported; we report it and immediately end it with a .failed reason.
  private func reportDummyCallAndFinish(completion: @escaping () -> Void) {
    let uuid   = UUID()
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: "Unknown")
    provider.reportNewIncomingCall(with: uuid, update: update) { _ in
      self.provider.reportCall(with: uuid, endedAt: Date(), reason: .failed)
      completion()
    }
  }
}

// MARK: - CXProviderDelegate

extension GywVoIPPushDelegate: CXProviderDelegate {

  // Called when the system resets (e.g., app resumes from background with
  // stale calls or Bluetooth device reconnects).  Clear local state.
  public func providerDidReset(_ provider: CXProvider) {
    print("[GywVoIP] providerDidReset — clearing pending call state")
    pendingCallUUID = nil
    pendingCallId   = nil
  }

  // ── User accepted call from CallKit UI ────────────────────────────────────

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let callId = pendingCallId else {
      print("[GywVoIP] CXAnswerCallAction — no pending callId, failing action")
      action.fail()
      return
    }
    print("[GywVoIP] CXAnswerCallAction → callId=\(callId)")
    action.fulfill()

    // Navigate to the in-app call screen.
    // Expo Router handles `gyw://call/<id>?accept=1` automatically.
    DispatchQueue.main.async {
      guard let url = URL(string: "gyw://call/\(callId)?accept=1") else { return }
      if UIApplication.shared.canOpenURL(url) {
        UIApplication.shared.open(url, options: [:])
      }
    }
  }

  // ── User declined / ended call from CallKit UI ────────────────────────────

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard let callId = pendingCallId else {
      action.fail()
      return
    }
    print("[GywVoIP] CXEndCallAction → rejecting callId=\(callId)")
    action.fulfill()

    let savedCallId = callId
    pendingCallUUID = nil
    pendingCallId   = nil

    // Reject without an authenticated session (lock-screen reject path).
    // rejectCallAnon is the unauthenticated Cloud Function callable.
    rejectCallViaCloudFunction(callId: savedCallId)
  }

  // ── Audio session routing ─────────────────────────────────────────────────

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // Hand audio session control to react-native-incall-manager (or WebRTC).
    // RNInCallManager listens for this notification automatically.
    print("[GywVoIP] Audio session activated")
    NotificationCenter.default.post(
      name: NSNotification.Name("RNCallKeepDidActivateAudioSession"),
      object: nil
    )
  }

  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    print("[GywVoIP] Audio session deactivated")
    NotificationCenter.default.post(
      name: NSNotification.Name("RNCallKeepDidDeactivateAudioSession"),
      object: nil
    )
  }

  // MARK: Cloud Function reject (unauthenticated)

  /// Posts to the `rejectCallAnon` callable so the callee's Firestore status
  /// is set to "rejected" without requiring a Firebase Auth token.
  /// The Cloud Function validates that the call is still in "ringing" state.
  private func rejectCallViaCloudFunction(callId: String) {
    // Replace with your project's actual Cloud Functions base URL.
    let baseURL = "https://us-central1-gyw1-146d7.cloudfunctions.net/rejectCallAnon"
    guard let url = URL(string: baseURL) else { return }

    var request        = URLRequest(url: url, timeoutInterval: 10)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody   = try? JSONSerialization.data(
      withJSONObject: ["data": ["callId": callId]]
    )

    URLSession.shared.dataTask(with: request) { _, response, error in
      if let error = error {
        print("[GywVoIP] rejectCallViaCloudFunction error:", error.localizedDescription)
      } else {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        print("[GywVoIP] rejectCallViaCloudFunction HTTP", code)
      }
    }.resume()
  }
}
