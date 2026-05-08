/**
 * lib/fcmTokenService.ts
 *
 * Registers FCM (Android + iOS) and VoIP/PushKit (iOS) tokens into
 * Firestore  userTokens/{uid}  so the `initiateCall` Cloud Function
 * can reach the device when a call is placed.
 *
 * ── Call sites ───────────────────────────────────────────────────────────
 *   registerPushTokens(uid)   — call once after the user signs in
 *   unregisterPushTokens()    — call once when the user signs out
 *
 * ── iOS VoIP token (PushKit) ─────────────────────────────────────────────
 *   Priority 1: react-native-voip-push-notification JS event
 *   Priority 2: AsyncStorage key 'gyw_voip_token' (written by native side)
 *   Without a valid VoIP token the `initiateCall` CF skips the APNs path
 *   and the phone will NOT ring on iOS when the app is killed.
 *
 * ── Android ──────────────────────────────────────────────────────────────
 *   FCM data-only + priority:high is sufficient.
 *   GywFirebaseMessagingService.kt wakes the device and starts the FGS.
 */

import { Platform } from 'react-native';

// ── Cleanup refs ──────────────────────────────────────────────────────────
let _unsubTokenRefresh: (() => void) | null = null;
let _unsubVoipRegister: (() => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────

export async function registerPushTokens(userId: string): Promise<void> {
  if (!userId || Platform.OS === 'web') return;

  try {
    // Lazy-require so the module is never loaded on web
    const messagingModule = require('@react-native-firebase/messaging').default as
      typeof import('@react-native-firebase/messaging').default;
    const messaging = messagingModule();

    // ── 1. Request notification permission ──────────────────────────────
    // iOS requires an explicit prompt; Android 13+ requires POST_NOTIFICATIONS.
    // VoIP pushes (PushKit) are NOT gated by this permission, but we request
    // it so heads-up notifications for other events (chat messages) also appear.
    try {
      const authStatus = await messaging.requestPermission({
        alert:         true,
        badge:         true,
        sound:         true,
        provisional:   false,
        criticalAlert: false,
      });
      const enabled =
        authStatus === 1 /* AUTHORIZED */ ||
        authStatus === 2 /* PROVISIONAL */;
      if (__DEV__ && !enabled) {
        console.warn('[fcmTokenService] notification permission not granted — status:', authStatus);
      }
    } catch (permErr) {
      // Android throws if permission is denied at OS level — non-fatal.
      if (__DEV__) console.warn('[fcmTokenService] requestPermission error:', permErr);
    }

    // ── 2. Get FCM registration token ───────────────────────────────────
    let fcmToken: string | null = null;
    try {
      fcmToken = await messaging.getToken();
    } catch (err) {
      console.warn('[fcmTokenService] getToken() failed:', err);
    }

    if (!fcmToken) {
      console.warn('[fcmTokenService] no FCM token — cannot register. Push will not work.');
      return;
    }

    if (__DEV__) {
      console.log('[fcmTokenService] FCM token prefix:', fcmToken.slice(0, 16) + '…');
    }

    // ── 3. Firestore context ─────────────────────────────────────────────
    const { getRnFirestore, hasRnFirebase } = require('@/lib/rnFirebase') as
      typeof import('@/lib/rnFirebase');
    if (!hasRnFirebase) return;

    let rnFirestoreMod: typeof import('@react-native-firebase/firestore') | null = null;
    try {
      rnFirestoreMod = require('@react-native-firebase/firestore');
    } catch {
      console.warn('[fcmTokenService] @react-native-firebase/firestore not available');
      return;
    }
    const rnDb = getRnFirestore();

    // ── 4. Build the document payload ────────────────────────────────────
    const tokenData: Record<string, any> = {
      uid:       userId,
      fcmToken,
      platform:  Platform.OS,
      updatedAt: rnFirestoreMod!.serverTimestamp(),
    };

    // ── 5. iOS: add VoIP/PushKit token ───────────────────────────────────
    if (Platform.OS === 'ios') {
      const voipToken = await _fetchVoipToken(userId, rnDb, rnFirestoreMod!);
      if (voipToken) {
        tokenData.voipToken = voipToken;
        if (__DEV__) console.log('[fcmTokenService] VoIP token prefix:', voipToken.slice(0, 12) + '…');
      } else {
        console.warn(
          '[fcmTokenService] no VoIP token found. ' +
          'iOS killed-state calls will not work until the token is registered. ' +
          'Ensure react-native-voip-push-notification is installed and GywVoIPPushDelegate.setup() called.',
        );
      }
    }

    // ── 6. Persist to Firestore ──────────────────────────────────────────
    const tokenRef = rnFirestoreMod!.doc(rnDb, 'userTokens', userId);
    await rnFirestoreMod!.setDoc(tokenRef, tokenData, { merge: true });

    if (__DEV__) {
      console.log('[fcmTokenService] tokens written to Firestore uid=', userId);
    }

    // ── 7. Keep FCM token fresh across rotation ──────────────────────────
    _unsubTokenRefresh?.();
    _unsubTokenRefresh = messaging.onTokenRefresh(async (newToken: string) => {
      try {
        const freshDb  = getRnFirestore();
        const freshMod = require('@react-native-firebase/firestore') as
          typeof import('@react-native-firebase/firestore');
        const ref = freshMod.doc(freshDb, 'userTokens', userId);
        await freshMod.setDoc(ref, {
          fcmToken:  newToken,
          updatedAt: freshMod.serverTimestamp(),
        }, { merge: true });
        if (__DEV__) console.log('[fcmTokenService] FCM token refreshed');
      } catch (e) {
        console.warn('[fcmTokenService] onTokenRefresh write failed:', e);
      }
    });

  } catch (err) {
    console.error('[fcmTokenService] registerPushTokens failed:', err);
  }
}

export async function unregisterPushTokens(): Promise<void> {
  // Detach listeners first — prevents stale writes after sign-out.
  _unsubTokenRefresh?.();
  _unsubTokenRefresh = null;
  _unsubVoipRegister?.();
  _unsubVoipRegister = null;

  if (Platform.OS === 'web') return;

  try {
    const messagingModule = require('@react-native-firebase/messaging').default as
      typeof import('@react-native-firebase/messaging').default;
    await messagingModule().deleteToken();
    if (__DEV__) console.log('[fcmTokenService] FCM token deleted');
  } catch (e) {
    // Non-fatal: the token expires on its own.
    if (__DEV__) console.warn('[fcmTokenService] deleteToken failed:', e);
  }
}

// ── VoIP token helper (iOS only) ──────────────────────────────────────────

/**
 * Resolves the PushKit VoIP token. Tries three strategies in order:
 *
 * 1. react-native-voip-push-notification  (proper JS bridge, fires 'register' event)
 * 2. AsyncStorage key 'gyw_voip_token'    (set natively by GywVoIPPushDelegate.swift
 *                                          if you add the UserDefaults save below)
 * 3. Returns null — caller logs a warning.
 */
async function _fetchVoipToken(
  userId: string,
  rnDb: any,
  mod: typeof import('@react-native-firebase/firestore'),
): Promise<string | null> {

  // ── Strategy 1: react-native-voip-push-notification ─────────────────────
  try {
    const VoipPush = require('react-native-voip-push-notification').default;

    const token = await new Promise<string | null>((resolve) => {
      // 5-second timeout in case PushKit doesn't respond (e.g. simulator)
      const timer = setTimeout(() => {
        VoipPush.removeEventListener('register', onRegister);
        resolve(null);
      }, 5_000);

      const onRegister = (t: string) => {
        clearTimeout(timer);
        // Cache to AsyncStorage for subsequent launches (Strategy 2 fallback).
        try {
          const AS = require('@react-native-async-storage/async-storage').default;
          void AS.setItem('gyw_voip_token', t);
        } catch {}
        resolve(t);
      };

      VoipPush.addEventListener('register', onRegister);
      VoipPush.registerVoipToken();

      // Keep listener alive after this call for future token rotations.
      _unsubVoipRegister?.();
      _unsubVoipRegister = () => {
        VoipPush.removeEventListener('register', onRegister);
      };

      // On token rotation: update Firestore immediately without waiting for
      // the next app launch.
      VoipPush.addEventListener('register', async (newToken: string) => {
        try {
          const ref = mod.doc(rnDb, 'userTokens', userId);
          await mod.setDoc(ref, {
            voipToken: newToken,
            updatedAt: mod.serverTimestamp(),
          }, { merge: true });
          try {
            const AS = require('@react-native-async-storage/async-storage').default;
            await AS.setItem('gyw_voip_token', newToken);
          } catch {}
          if (__DEV__) console.log('[fcmTokenService] VoIP token rotated + saved');
        } catch {}
      });
    });

    if (token) return token;
  } catch {
    // Package not installed — fall through to Strategy 2.
  }

  // ── Strategy 2: AsyncStorage cache ──────────────────────────────────────
  // Populated by react-native-voip-push-notification on a prior launch,
  // OR by native Swift code (add to GywVoIPPushDelegate.swift):
  //
  //   import React           // for RCTSharedApplication or ReactNativeModule
  //   UserDefaults.standard.set(token, forKey: "gyw_voip_token")
  //   // Then in JS: NativeModules.SettingsManager reads UserDefaults keys
  //
  // For a simpler bridge: add to pushRegistry(_:didUpdate:) in Swift:
  //   RNAsyncStorage.save(["gyw_voip_token": token])  — if using RNAsyncStorageDataStore
  try {
    const AS = require('@react-native-async-storage/async-storage').default;
    const cached = await AS.getItem('gyw_voip_token');
    if (cached) return cached as string;
  } catch {}

  return null;
}
