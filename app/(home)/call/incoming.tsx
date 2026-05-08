/**
 * app/(home)/call/incoming.tsx
 *
 * Full-screen in-app incoming call UI.
 *
 * When does this screen appear?
 * ─────────────────────────────
 *   iOS (app in foreground)  — useCallManager navigates here when
 *                              NotificationService receives an INCOMING_CALL
 *                              push while the user is already in the app.
 *                              The system CallKit sheet is also shown by
 *                              callkeep.displayIncomingCall().
 *
 *   Android (app in foreground) — GywFirebaseMessagingService launches
 *                              IncomingCallActivity natively.  This screen
 *                              is a JS-layer fallback / mirror that can be
 *                              used when the app is in the foreground and
 *                              the native activity is not shown.
 *
 * Params (via expo-router useLocalSearchParams)
 * ─────────────────────────────────────────────
 *   callId       — Firestore call document id (required)
 *   callerName   — Display name (fallback: "Incoming call")
 *   callerAvatar — HTTP(S) URL of the caller's avatar (optional)
 *   callType     — "audio" | "video" (default: "audio")
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PreviewAvatar from '@/components/PreviewAvatar';
import { useAuth } from '@/contexts/AuthContext';
import { callManagerActionsRef } from '@/lib/hooks/useCallManager';
import { useCallManagerStore } from '@/store/callManagerStore';
import { subscribeToCall } from '@/lib/services/callService';

// ── Screen ────────────────────────────────────────────────────────────────────

const IncomingCallScreen = () => {
  const { t }     = useTranslation();
  const router    = useRouter();
  const insets    = useSafeAreaInsets();
  const { user }  = useAuth();

  const {
    callId,
    callerName: callerNameParam = 'Incoming call',
    callerAvatar,
    callType: callTypeParam = 'audio',
  } = useLocalSearchParams<{
    callId:       string;
    callerName?:  string;
    callerAvatar?: string;
    callType?:    'audio' | 'video';
  }>();

  const callType   = callTypeParam === 'video' ? 'video' : 'audio';
  const callerName = callerNameParam || 'Incoming call';

  // Derive display name from the Zustand store if available (more up-to-date).
  const storedIncoming = useCallManagerStore((s) => s.incomingCall);
  const displayName =
    storedIncoming?.callId === callId
      ? storedIncoming.callerName
      : callerName;
  const displayAvatar =
    storedIncoming?.callId === callId
      ? (storedIncoming.callerAvatar ?? callerAvatar)
      : callerAvatar;

  // ── Auto-dismiss if the call disappears from Firestore ────────────────────

  useEffect(() => {
    if (!callId) return;

    const unsub = subscribeToCall(callId, (callData) => {
      if (!callData) {
        router.back();
        return;
      }
      if (['ended', 'missed', 'rejected', 'busy'].includes(callData.status)) {
        router.back();
      }
    });

    return () => unsub();
  }, [callId, router]);

  // Auto-dismiss if the Zustand store clears the incoming call
  // (e.g. CALL_CANCELLED push received by NotificationService).
  useEffect(() => {
    if (storedIncoming === null) {
      // A tiny delay avoids a flash if navigation was already in progress.
      const t = setTimeout(() => {
        try { router.back(); } catch (_) {}
      }, 200);
      return () => clearTimeout(t);
    }
  }, [storedIncoming, router]);

  // ── Pulsing ring animation ────────────────────────────────────────────────

  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const buildPulse = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue:         1.7,
            duration:        1000,
            easing:          Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue:         1,
            duration:        0,
            useNativeDriver: true,
          }),
        ]),
      );

    const a1 = buildPulse(pulse1, 0);
    const a2 = buildPulse(pulse2, 320);
    const a3 = buildPulse(pulse3, 640);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [pulse1, pulse2, pulse3]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAccept = async () => {
    await callManagerActionsRef.answerCall(callId);
  };

  const handleDecline = async () => {
    await callManagerActionsRef.rejectCall(callId);
    try { router.back(); } catch (_) {}
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const subtitleKey =
    callType === 'video' ? 'calls.incomingVideoCall' : 'calls.incomingAudioCall';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Caller info ──────────────────────────────────────────────────── */}
      <View style={[styles.topSection, { paddingTop: insets.top + 60 }]}>
        {/* Animated pulse rings */}
        <View style={styles.pulseContainer}>
          {[pulse1, pulse2, pulse3].map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                styles.pulseRing,
                { transform: [{ scale: anim }], opacity: anim.interpolate({
                  inputRange:  [1, 1.7],
                  outputRange: [0.35 - i * 0.08, 0],
                }) },
              ]}
            />
          ))}

          {/* Avatar sits on top of the rings */}
          <View style={styles.avatarWrapper}>
            <PreviewAvatar
              name={displayName}
              image={displayAvatar || undefined}
              size={112}
              fontSize={44}
            />
          </View>
        </View>

        <Text style={styles.callerName} numberOfLines={1} adjustsFontSizeToFit>
          {displayName}
        </Text>

        <Text style={styles.callSubtitle}>
          {t(subtitleKey)}
        </Text>
      </View>

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + 40 }]}>
        {/* Decline */}
        <View style={styles.buttonColumn}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('calls.decline')}
            onPress={handleDecline}
            style={({ pressed }) => [
              styles.actionButton,
              styles.declineButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons
              name="call"
              size={32}
              color="white"
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </Pressable>
          <Text style={styles.buttonLabel}>{t('calls.decline')}</Text>
        </View>

        {/* Accept */}
        <View style={styles.buttonColumn}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('calls.accept')}
            onPress={handleAccept}
            style={({ pressed }) => [
              styles.actionButton,
              styles.acceptButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="call" size={32} color="white" />
          </Pressable>
          <Text style={styles.buttonLabel}>{t('calls.accept')}</Text>
        </View>
      </View>
    </View>
  );
};

export default IncomingCallScreen;

// ── Styles ────────────────────────────────────────────────────────────────────

const DECLINE_COLOR = '#FF3B30';
const ACCEPT_COLOR  = '#34C759';
const BG_TOP        = '#1a1a2e';
const BG_BOTTOM     = '#16213e';

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: BG_TOP,
  },

  // ── Top caller section ─────────────────────────────────────────────────────
  topSection: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  pulseContainer: {
    width:          160,
    height:         160,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   28,
  },

  pulseRing: {
    position:        'absolute',
    width:           130,
    height:          130,
    borderRadius:    65,
    backgroundColor: '#ffffff',
  },

  avatarWrapper: {
    // Elevate the avatar above the rings.
    zIndex: 10,
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8 },
      android: { elevation: 10 },
    }),
  },

  callerName: {
    fontSize:   30,
    fontWeight: '700',
    color:      '#ffffff',
    textAlign:  'center',
    marginBottom: 8,
  },

  callSubtitle: {
    fontSize:   17,
    color:      'rgba(255,255,255,0.65)',
    textAlign:  'center',
  },

  // ── Bottom action section ──────────────────────────────────────────────────
  bottomSection: {
    flexDirection:   'row',
    justifyContent:  'space-around',
    alignItems:      'center',
    paddingHorizontal: 48,
    backgroundColor: BG_BOTTOM,
    paddingTop:      32,
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
  },

  buttonColumn: {
    alignItems: 'center',
    gap:        10,
  },

  actionButton: {
    width:          80,
    height:         80,
    borderRadius:   40,
    alignItems:     'center',
    justifyContent: 'center',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6 },
      android: { elevation: 8 },
    }),
  },

  declineButton: {
    backgroundColor: DECLINE_COLOR,
  },

  acceptButton: {
    backgroundColor: ACCEPT_COLOR,
  },

  buttonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.95 }],
  },

  buttonLabel: {
    fontSize:   14,
    color:      'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
});
