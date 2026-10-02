import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import CallerInfoBlock from '@/components/calls/incoming/shared/CallerInfoBlock';
import IncomingCallActions from '@/components/calls/incoming/shared/IncomingCallActions';
import { CALL_COLORS, type IncomingCallData } from '@/constants/CallTheme';

const BACKGROUND = '#0D1B2A';
const SLIDE_OFFSET = 60;
const SLIDE_DURATION_MS = 350;
const BOTTOM_ACTIONS_PADDING = 48;
const VIBRATION_PATTERN = [0, 400, 200, 400] as const;

const QUICK_REPLIES = [
  "Can't talk right now",
  'On my way',
  'Call me later',
] as const;

export type AudioIncomingCallUIProps = {
  callData: IncomingCallData;
  onAccept: () => void;
  onDecline: () => void;
  onMessage?: (message: string) => void;
};

function AudioIncomingCallUI({
  callData,
  onAccept,
  onDecline,
  onMessage,
}: AudioIncomingCallUIProps) {
  const insets = useSafeAreaInsets();
  const { caller, callType } = callData;
  const displayName = caller.displayName;
  const photoURL = caller.photoURL;

  const [messageSheetOpen, setMessageSheetOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const slideY = useRef(new Animated.Value(SLIDE_OFFSET)).current;
  const sheetTranslateY = useRef(new Animated.Value(400)).current;
  const vibrationActive = useRef(true);

  const stopVibration = useCallback(() => {
    vibrationActive.current = false;
    Vibration.cancel();
  }, []);

  const startVibration = useCallback(() => {
    vibrationActive.current = true;
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate([...VIBRATION_PATTERN], true);
    }
  }, []);

  useEffect(() => {
    startVibration();
    Animated.timing(slideY, {
      toValue: 0,
      duration: SLIDE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    return () => {
      stopVibration();
    };
  }, [slideY, startVibration, stopVibration]);

  const closeMessageSheet = useCallback(() => {
    if (!messageSheetOpen) return;
    Keyboard.dismiss();
    Animated.timing(sheetTranslateY, {
      toValue: 400,
      duration: 280,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMessageSheetOpen(false);
    });
  }, [messageSheetOpen, sheetTranslateY]);

  const openMessageSheet = useCallback(() => {
    setMessageSheetOpen(true);
    sheetTranslateY.setValue(400);
    Animated.timing(sheetTranslateY, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sheetTranslateY]);

  useEffect(() => {
    if (!messageSheetOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeMessageSheet();
      return true;
    });
    return () => sub.remove();
  }, [messageSheetOpen, closeMessageSheet]);

  const handleAccept = useCallback(() => {
    stopVibration();
    closeMessageSheet();
    onAccept();
  }, [stopVibration, closeMessageSheet, onAccept]);

  const handleDecline = useCallback(() => {
    stopVibration();
    closeMessageSheet();
    onDecline();
  }, [stopVibration, closeMessageSheet, onDecline]);

  const handleSendQuickMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stopVibration();
      closeMessageSheet();
      onMessage?.(trimmed);
      onDecline();
    },
    [stopVibration, closeMessageSheet, onMessage, onDecline],
  );

  const handleMessageButton = onMessage ? openMessageSheet : undefined;

  return (
    <Animated.View
      style={[styles.root, { transform: [{ translateY: slideY }] }]}
      accessibilityViewIsModal
      accessibilityLabel={`Incoming call from ${displayName}`}
    >
      <StatusBar hidden animated />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.backgroundLayer} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, styles.solidBg]} />
          {photoURL ? (
            <>
              <Image
                source={{ uri: photoURL }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={Platform.OS === 'android' ? 12 : 0}
              />
              <BlurView
                intensity={60}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            </>
          ) : null}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.6)']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        <View style={[styles.content, { paddingTop: insets.top + 12 }]}>
          <View
            style={styles.appPill}
            accessibilityRole="text"
            accessibilityLabel="Gyw"
          >
            <Text allowFontScaling={false} style={styles.appPillText}>
              Gyw
            </Text>
          </View>

          <View style={styles.callerSection}>
            <CallerInfoBlock
              displayName={displayName}
              photoURL={photoURL}
              callType={callType === 'video' ? 'video' : 'audio'}
              rippleColor={CALL_COLORS.rippleBase}
            />
          </View>

        </View>

        <IncomingCallActions
          callType="audio"
          onAccept={handleAccept}
          onDecline={handleDecline}
          onMessage={handleMessageButton}
        />

        {messageSheetOpen ? (
          <Pressable
            style={styles.sheetBackdrop}
            accessibilityRole="button"
            accessibilityLabel="Dismiss quick message"
            onPress={closeMessageSheet}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.sheetKeyboard}
              pointerEvents="box-none"
            >
              <Animated.View
                style={[
                  styles.messageSheet,
                  {
                    paddingBottom: insets.bottom + 16,
                    transform: [{ translateY: sheetTranslateY }],
                  },
                ]}
              >
                <Pressable onPress={(e) => e.stopPropagation()}>
                  <View style={styles.sheetHandle} />
                  <Text allowFontScaling={false} style={styles.sheetTitle}>
                    Quick reply
                  </Text>

                  <View style={styles.chipRow}>
                    {QUICK_REPLIES.map((reply) => (
                      <Pressable
                        key={reply}
                        accessibilityRole="button"
                        accessibilityLabel={`Send message: ${reply}`}
                        onPress={() => handleSendQuickMessage(reply)}
                        style={({ pressed }) => [
                          styles.chip,
                          pressed && styles.chipPressed,
                        ]}
                      >
                        <Text allowFontScaling={false} style={styles.chipText}>
                          {reply}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.customRow}>
                    <TextInput
                      value={customMessage}
                      onChangeText={setCustomMessage}
                      placeholder="Type a message…"
                      placeholderTextColor="rgba(0,0,0,0.45)"
                      style={styles.customInput}
                      accessibilityLabel="Custom quick message"
                      returnKeyType="send"
                      onSubmitEditing={() => handleSendQuickMessage(customMessage)}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Send custom message and decline call"
                      onPress={() => handleSendQuickMessage(customMessage)}
                      style={({ pressed }) => [
                        styles.sendBtn,
                        pressed && styles.sendBtnPressed,
                      ]}
                    >
                      <Ionicons name="send" size={20} color="#ffffff" />
                    </Pressable>
                  </View>
                </Pressable>
              </Animated.View>
            </KeyboardAvoidingView>
          </Pressable>
        ) : null}
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  safe: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  solidBg: {
    backgroundColor: BACKGROUND,
  },
  content: {
    flex: 1,
  },
  appPill: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 8,
  },
  appPillText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  callerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    marginTop: '8%',
    paddingBottom: 160,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetKeyboard: {
    justifyContent: 'flex-end',
  },
  messageSheet: {
    backgroundColor: 'rgba(18, 28, 42, 0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    marginBottom: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  chip: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipText: {
    fontSize: 14,
    color: '#0D1B2A',
    fontWeight: '500',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  customInput: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
    color: '#0D1B2A',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CALL_COLORS.acceptGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: {
    opacity: 0.88,
  },
});

export default AudioIncomingCallUI;
