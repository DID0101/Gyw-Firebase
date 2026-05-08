/**
 * AppDelegate_VoIP_patch.m
 *
 * Reference file — shows exactly what ios/<AppName>/AppDelegate.mm should
 * look like after `expo prebuild` + `withIosVoIP` plugin runs.
 *
 * DO NOT compile this file directly.
 * The plugin (plugins/withIosVoIP.js) applies the two marked changes
 * automatically.  If you need to patch by hand, follow the instructions below.
 *
 * ── Two changes needed in AppDelegate.mm ─────────────────────────────────────
 *
 *   CHANGE 1 — add import at the top (after #import "AppDelegate.h"):
 *     #import "GywVoIPPushDelegate-Swift.h"
 *
 *   CHANGE 2 — add setup call inside didFinishLaunchingWithOptions,
 *               AFTER [super application:…] returns:
 *     [[GywVoIPPushDelegate shared] setup];
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPLETE PATCHED AppDelegate.mm (copy verbatim to ios/<AppName>/AppDelegate.mm)
 * ─────────────────────────────────────────────────────────────────────────────

// ── Expo / React Native boilerplate ──────────────────────────────────────────
#import "AppDelegate.h"

// ── VoIP: auto-generated Objective-C bridging header for GywVoIPPushDelegate.swift
// Xcode generates this file name from the Swift class name + "-Swift.h".
// It only exists after the Swift file is added to the Xcode target.
#import "GywVoIPPushDelegate-Swift.h"   // ← CHANGE 1

// Firebase (needed if you use @react-native-firebase)
#import <Firebase.h>

// React Native core
#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // ── Firebase must be configured before any other Firebase call ─────────────
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }

  // ── Expo / React Native root setup ─────────────────────────────────────────
  self.moduleName   = @"main";
  self.initialProps = @{};

  // [super …] starts the React Native bridge.  Call it BEFORE setup so the
  // RN bridge is ready to receive events from GywVoIPPushDelegate.
  BOOL result = [super application:application
             didFinishLaunchingWithOptions:launchOptions];

  // ── VoIP: register PushKit + configure CallKit ──────────────────────────────
  // This must run after [super …] so the RN bridge is alive.
  // GywVoIPPushDelegate.setup() calls:
  //   PKPushRegistry(queue:.main) → triggers didUpdatePushCredentials once registered
  //   CXProvider.setDelegate(self)
  [[GywVoIPPushDelegate shared] setup];                       // ← CHANGE 2

  return result;
}

// ── Bundle URL (Expo managed) ──────────────────────────────────────────────────

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings]
              jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main"
                                 withExtension:@"jsbundle"];
#endif
}

// ── Deep linking ───────────────────────────────────────────────────────────────
// Required for gyw://call/<id>?accept=1 links from CallKit answer action.

- (BOOL)application:(UIApplication *)app
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:app openURL:url options:options];
}

- (BOOL)application:(UIApplication *)application
    continueUserActivity:(NSUserActivity *)userActivity
      restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> *))handler
{
  return [RCTLinkingManager application:application
                   continueUserActivity:userActivity
                     restorationHandler:handler];
}

@end

 * ─────────────────────────────────────────────────────────────────────────────
 * BRIDGING HEADER (ios/<AppName>/<AppName>-Bridging-Header.h)
 * ─────────────────────────────────────────────────────────────────────────────
 * Xcode creates this automatically when you first add a Swift file to an
 * Objective-C project.  Accept the prompt.  The file itself can be empty —
 * the import of GywVoIPPushDelegate-Swift.h in AppDelegate.mm is sufficient.
 *
 *   // <AppName>-Bridging-Header.h
 *   // No content needed — Swift classes are exposed via -Swift.h auto-headers
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * XCODE MANUAL STEPS (only needed for bare RN / first-time setup)
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Open ios/<AppName>.xcworkspace in Xcode.
 * 2. Select the <AppName> target → Build Settings → search "Swift".
 *    Ensure "Swift Language Version" is set to Swift 5.
 * 3. File → Add Files to "<AppName>" → select ios-native-src/GywVoIPPushDelegate.swift
 *    Check "Add to target: <AppName>". Accept the bridging header prompt.
 * 4. Target → Build Settings → "Objective-C Bridging Header"
 *    should now read: $(SRCROOT)/<AppName>/<AppName>-Bridging-Header.h
 *    If it's missing, set it manually.
 * 5. Product → Build (⌘B) — if "GywVoIPPushDelegate-Swift.h not found", confirm
 *    step 3 and that the Swift file's target membership is checked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPO MANAGED WORKFLOW
 * ─────────────────────────────────────────────────────────────────────────────
 * plugins/withIosVoIP.js handles steps 3–4 and the two AppDelegate changes
 * automatically every time you run:
 *   npx expo prebuild --clean --platform ios
 *
 * You do NOT need to edit AppDelegate.mm manually in an Expo project.
 */

// This file is documentation only — no compilable code outside the comment block.
