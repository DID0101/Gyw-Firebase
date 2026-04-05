/**
 * GywCallKitProvider.swift
 *
 * Singleton CXProvider shared between GywVoIPPushDelegate and react-native-callkeep.
 *
 * react-native-callkeep creates its own CXProvider internally. For the VoIP-push killed-app
 * path we need a CXProvider that's available BEFORE the JS bridge loads. This singleton is
 * configured to match callkeep's configuration so system call UI looks consistent.
 *
 * PLACEMENT: ios/<AppName>/ (same directory as GywVoIPPushDelegate.swift)
 */

import Foundation
import CallKit

@objc public class GywCallKitProvider: NSObject, CXProviderDelegate {

  @objc public static let shared = GywCallKitProvider()

  public let provider: CXProvider

  private override init() {
    let config = CXProviderConfiguration()
    config.supportsVideo = true
    config.maximumCallsPerCallGroup = 1
    config.supportedHandleTypes = [.generic]
    // Match the app icon used in callkeep config (ios.appName)
    config.localizedName = "GYW"
    provider = CXProvider(configuration: config)
    super.init()
    provider.setDelegate(self, queue: .main)
  }

  // MARK: - CXProviderDelegate (minimal — react-native-callkeep takes over after JS loads)

  public func providerDidReset(_ provider: CXProvider) {
    NSLog("[GywCallKit] providerDidReset")
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    NSLog("[GywCallKit] CXAnswerCallAction uuid=\(action.callUUID)")
    // react-native-callkeep's own provider delegate handles this once the bridge loads.
    // If the bridge isn't ready yet, store the answered UUID so JS can pick it up.
    UserDefaults.standard.set(action.callUUID.uuidString, forKey: "GywAnsweredCallUUID")
    UserDefaults.standard.synchronize()
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    NSLog("[GywCallKit] CXEndCallAction uuid=\(action.callUUID)")
    UserDefaults.standard.removeObject(forKey: "GywPendingCallId")
    UserDefaults.standard.removeObject(forKey: "GywPendingCallUUID")
    UserDefaults.standard.removeObject(forKey: "GywAnsweredCallUUID")
    UserDefaults.standard.synchronize()
    action.fulfill()
  }
}
