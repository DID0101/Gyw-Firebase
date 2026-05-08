/**
 * components/CallDebugOverlay.tsx
 *
 * Floating debug panel — renders ONLY in __DEV__ builds.
 * Shows FCM/VoIP tokens, last push payload, active call state, and
 * a "Simulate incoming call" button that exercises the full JS flow.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   // app/(home)/_layout.tsx  (or AppContent)
 *   import CallDebugOverlay from '@/components/CallDebugOverlay';
 *   ...
 *   return (
 *     <>
 *       <Stack ... />
 *       <CallDebugOverlay />   {/* renders nothing in release * /}
 *     </>
 *   );
 *
 * The overlay is draggable so it doesn't obscure the UI under test.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Clipboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCallManagerStore,
  type IncomingCallInfo,
} from '@/store/callManagerStore';
import { handleRemoteMessage } from '@/lib/services/NotificationService';

// ── Types ─────────────────────────────────────────────────────────────────

interface PushSnapshot {
  payload: Record<string, unknown>;
  ts:      number;
}

// ── Debug state — module-level so it survives re-renders ──────────────────

/**
 * Patch NotificationService.handleRemoteMessage to capture the last
 * received payload.  Only done once per app session.
 */
let _patched = false;
let _lastPush: PushSnapshot | null = null;
const _listeners: Set<() => void> = new Set();

function patchNotificationService(): void {
  if (_patched) return;
  _patched = true;

  // We can't easily monkey-patch an ES module, so instead we read
  // the last payload from the AsyncStorage key that the background
  // headless handler writes (see index.js).  No patching needed.
}

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

// Poll AsyncStorage for the most-recent headless push snapshot.
async function pollLastPush(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('rnCallKeepBgAction');
    if (raw) {
      const data = JSON.parse(raw) as Record<string, unknown>;
      _lastPush = { payload: data, ts: (data.ts as number) ?? Date.now() };
      notifyListeners();
    }
  } catch (_) {}
}

// ── Helper: uuidv4 ────────────────────────────────────────────────────────

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Sub-component: token row ──────────────────────────────────────────────

function TokenRow({ label, value }: { label: string; value: string }) {
  const shortened = value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-8)}` : value;

  const handleCopy = () => {
    Clipboard.setString(value);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Copied', ToastAndroid.SHORT);
    }
  };

  return (
    <TouchableOpacity onPress={handleCopy} style={styles.tokenRow}>
      <Text style={styles.tokenLabel}>{label}</Text>
      <Text style={styles.tokenValue} numberOfLines={1}>{shortened || '—'}</Text>
    </TouchableOpacity>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────

export default function CallDebugOverlay() {
  // Only render in dev
  if (!__DEV__) return null;

  return <CallDebugOverlayInner />;
}

function CallDebugOverlayInner() {
  const { user }         = useAuth();
  const incomingCall     = useCallManagerStore((s) => s.incomingCall);
  const outgoingCall     = useCallManagerStore((s) => s.outgoingCall);
  const callStatus       = useCallManagerStore((s) => s.callStatus);

  const [expanded,  setExpanded]  = useState(false);
  const [fcmToken,  setFcmToken]  = useState<string>('');
  const [voipToken, setVoipToken] = useState<string>('');
  const [lastPush,  setLastPush]  = useState<PushSnapshot | null>(null);
  const [simCallId, setSimCallId] = useState<string>('');

  // ── Draggable position ─────────────────────────────────────────────────

  const pan = useRef(new Animated.ValueXY({ x: 10, y: 80 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder:   () => true,
      onMoveShouldSetPanResponder:    () => true,
      onPanResponderGrant: () => {
        pan.setOffset({ x: (pan.x as any)._value, y: (pan.y as any)._value });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  // ── Token fetching ─────────────────────────────────────────────────────

  useEffect(() => {
    patchNotificationService();

    const fetchTokens = async () => {
      // FCM token
      try {
        const messaging = require('@react-native-firebase/messaging').default;
        const t = await messaging().getToken();
        setFcmToken(t ?? '');
      } catch (_) {}

      // VoIP token — stored in Firestore userTokens/{uid}.voipToken
      // Read from AsyncStorage cache if available (set by GywVoIPPushDelegate.swift
      // via the RN bridge when the token is registered).
      try {
        const cached = await AsyncStorage.getItem('gyw_voip_token');
        if (cached) setVoipToken(cached);
      } catch (_) {}
    };

    void fetchTokens();

    // Poll for last push snapshot
    void pollLastPush();
    const interval = setInterval(() => void pollLastPush(), 3000);

    const listener = () => setLastPush(_lastPush);
    _listeners.add(listener);

    return () => {
      clearInterval(interval);
      _listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    setLastPush(_lastPush);
  });

  // ── Simulate incoming call ─────────────────────────────────────────────

  const simulateIncomingCall = () => {
    const callId = uuidv4();
    setSimCallId(callId);

    handleRemoteMessage({
      messageId: `sim-${Date.now()}`,
      data: {
        type:         'INCOMING_CALL',
        callId,
        callerId:     user?.uid ?? 'debug-uid',
        callerName:   'Debug Caller',
        callerAvatar: '',
        callType:     'audio',
      },
    });
  };

  const simulateCancel = () => {
    if (!simCallId) return;
    handleRemoteMessage({
      messageId: `sim-cancel-${Date.now()}`,
      data: {
        type:    'CALL_CANCELLED',
        callId:  simCallId,
        callerId: user?.uid ?? 'debug-uid',
      },
    });
    setSimCallId('');
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const activeCall: IncomingCallInfo | null = incomingCall ?? null;

  return (
    <Animated.View
      style={[styles.container, { transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <Text style={styles.headerText}>
          {expanded ? '▼' : '▶'} 🔔 CallDebug
          {activeCall ? ` · 📞 ${activeCall.callId.slice(0, 8)}` : ''}
        </Text>
      </Pressable>

      {/* ── Body ────────────────────────────────────────────────────── */}
      {expanded && (
        <ScrollView style={styles.body} scrollEnabled contentContainerStyle={{ gap: 6 }}>

          {/* Tokens */}
          <Text style={styles.sectionTitle}>Tokens (tap to copy)</Text>
          <TokenRow label="FCM"  value={fcmToken}  />
          <TokenRow label="VoIP" value={voipToken} />

          {/* Call state */}
          <Text style={styles.sectionTitle}>Call State</Text>
          <Text style={styles.mono}>status: {callStatus}</Text>
          {activeCall && (
            <>
              <Text style={styles.mono}>callId: {activeCall.callId.slice(0, 16)}…</Text>
              <Text style={styles.mono}>caller: {activeCall.callerName}</Text>
              <Text style={styles.mono}>type: {activeCall.callType}</Text>
            </>
          )}
          {outgoingCall && (
            <Text style={styles.mono}>outgoing: {outgoingCall.calleeId.slice(0, 16)}…</Text>
          )}

          {/* Last push snapshot */}
          <Text style={styles.sectionTitle}>Last Background Push</Text>
          {lastPush ? (
            <>
              <Text style={styles.mono}>
                {new Date(lastPush.ts).toLocaleTimeString()}
              </Text>
              <Text style={styles.mono} numberOfLines={5}>
                {JSON.stringify(lastPush.payload, null, 2).slice(0, 300)}
              </Text>
            </>
          ) : (
            <Text style={styles.monoMuted}>No push captured yet</Text>
          )}

          {/* Simulate buttons */}
          <Text style={styles.sectionTitle}>Simulate</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.simButton}
              onPress={simulateIncomingCall}
            >
              <Text style={styles.simButtonText}>📲 Incoming Call</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.simButton, !simCallId && styles.simButtonDisabled]}
              onPress={simulateCancel}
              disabled={!simCallId}
            >
              <Text style={styles.simButtonText}>❌ Cancel</Text>
            </TouchableOpacity>
          </View>
          {simCallId ? (
            <Text style={styles.monoMuted}>simCallId: {simCallId.slice(0, 16)}…</Text>
          ) : null}

          {/* Clear store */}
          <TouchableOpacity
            style={[styles.simButton, { backgroundColor: '#555' }]}
            onPress={() => useCallManagerStore.getState().clearCall()}
          >
            <Text style={styles.simButtonText}>🗑 Clear Call Store</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const OVERLAY_W = 260;

const styles = StyleSheet.create({
  container: {
    position:        'absolute',
    zIndex:          9999,
    width:           OVERLAY_W,
    backgroundColor: 'rgba(10,10,20,0.93)',
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     '#0af',
    overflow:        'hidden',
  },
  header: {
    paddingHorizontal: 10,
    paddingVertical:   6,
    backgroundColor:   'rgba(0,160,240,0.3)',
  },
  headerText: {
    color:      '#0cf',
    fontSize:   12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '700',
  },
  body: {
    maxHeight:       320,
    padding:         8,
  },
  sectionTitle: {
    color:      '#aaa',
    fontSize:   10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '700',
    marginTop:  4,
    textTransform: 'uppercase',
  },
  tokenRow: {
    flexDirection:  'row',
    gap:            6,
    alignItems:     'center',
    paddingVertical: 1,
  },
  tokenLabel: {
    color:      '#0cf',
    fontSize:   11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    width:      36,
  },
  tokenValue: {
    color:      '#eee',
    fontSize:   10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex:        1,
  },
  mono: {
    color:      '#eee',
    fontSize:   10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  monoMuted: {
    color:      '#666',
    fontSize:   10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    gap:            6,
  },
  simButton: {
    backgroundColor: '#0af',
    borderRadius:    5,
    paddingVertical:   5,
    paddingHorizontal: 8,
    flex:             1,
  },
  simButtonDisabled: {
    backgroundColor: '#444',
  },
  simButtonText: {
    color:      '#000',
    fontSize:   11,
    fontWeight: '700',
    textAlign:  'center',
  },
});
