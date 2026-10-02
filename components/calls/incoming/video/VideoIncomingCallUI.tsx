import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
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
import { webRTCService } from '@/lib/services/webrtcService';
import { RTCView, isWebRTCAvailable } from '@/lib/webrtc-wrapper';

const SLIDE_OFFSET = 60;
const SLIDE_DURATION_MS = 350;
const BOTTOM_ACTIONS_PADDING = 48;
const VIBRATION_PATTERN = [0, 400, 200, 400] as const;
const VIDEO_AVATAR_SIZE = 88;
const PREVIEW_WIDTH = 120;
const PREVIEW_HEIGHT = 180;
const BLUR_INTENSITY = 85;

const QUICK_REPLIES = [
  "Can't talk right now",
  'On my way',
  'Call me later',
] as const;

export type VideoIncomingCallUIProps = {
  callData: IncomingCallData;
  onAccept: (opts: { withCamera: boolean }) => void;
  onDecline: () => void;
  onMessage?: (message: string) => void;
};

type LocalCameraPreviewProps = {
  enabled: boolean;
  topInset: number;
  /** When true, unmount must not stop the preview — call screen reuses it. */
  keepPreviewOnUnmountRef: MutableRefObject<boolean>;
};

const LocalCameraPreview = memo(function LocalCameraPreview({
  enabled,
  topInset,
  keepPreviewOnUnmountRef,
}: LocalCameraPreviewProps) {
  const [previewStream, setPreviewStream] = useState<{
    toURL: () => string;
  } | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!enabled) {
      webRTCService.stopIncomingPreviewStream();
      setPreviewStream(null);
      setCameraReady(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setPermissionDenied(false);
      setCameraReady(false);
      const existing = webRTCService.getIncomingPreviewStream();
      if (existing) {
        if (!cancelled) {
          setPreviewStream(existing);
          setCameraReady(true);
        }
        return;
      }
      const stream = await webRTCService.requestIncomingPreviewStream();
      if (cancelled) return;
      if (stream) {
        setPreviewStream(stream);
        setCameraReady(true);
      } else {
        setPermissionDenied(true);
      }
    })();

    return () => {
      cancelled = true;
      if (!keepPreviewOnUnmountRef.current) {
        webRTCService.stopIncomingPreviewStream();
      }
      setPreviewStream(null);
      setCameraReady(false);
    };
  }, [enabled, keepPreviewOnUnmountRef]);

  const showLivePreview =
    enabled &&
    cameraReady &&
    previewStream &&
    isWebRTCAvailable &&
    RTCView;

  return (
    <View
      style={[styles.previewPanel, { top: topInset + 12 }]}
      accessibilityLabel="Your camera preview"
    >
      {showLivePreview ? (
        <RTCView
          streamURL={previewStream.toURL()}
          objectFit="cover"
          style={styles.previewVideo}
          mirror
          zOrder={1}
        />
      ) : (
        <View style={styles.previewPlaceholder}>
          <Ionicons
            name={permissionDenied ? 'camera-outline' : 'videocam-outline'}
            size={28}
            color="rgba(255,255,255,0.55)"
          />
          <Text allowFontScaling={false} style={styles.previewPlaceholderText}>
            {permissionDenied ? 'Camera is off' : 'Camera preview'}
          </Text>
        </View>
      )}
      <View style={styles.previewYouPill}>
        <Text allowFontScaling={false} style={styles.previewYouText}>
          You
        </Text>
      </View>
    </View>
  );
});

function VideoIncomingCallUI({
  callData,
  onAccept,
  onDecline,
  onMessage,
}: VideoIncomingCallUIProps) {
  const insets = useSafeAreaInsets();
  const { caller } = callData;
  const displayName = caller.displayName;
  const photoURL = caller.photoURL;

  const [answerWithoutVideo, setAnswerWithoutVideo] = useState(false);
  const [messageSheetOpen, setMessageSheetOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const keepPreviewOnUnmountRef = useRef(false);
  const slideY = useRef(new Animated.Value(SLIDE_OFFSET)).current;
  const sheetTranslateY = useRef(new Animated.Value(400)).current;

  const stopVibration = useCallback(() => {
    Vibration.cancel();
  }, []);

  const startVibration = useCallback(() => {
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
    return stopVibration;
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
    if (!answerWithoutVideo) {
      keepPreviewOnUnmountRef.current = true;
    } else {
      webRTCService.stopIncomingPreviewStream();
    }
    onAccept({ withCamera: !answerWithoutVideo });
  }, [stopVibration, closeMessageSheet, onAccept, answerWithoutVideo]);

  const handleDecline = useCallback(() => {
    stopVibration();
    closeMessageSheet();
    webRTCService.stopIncomingPreviewStream();
    onDecline();
  }, [stopVibration, closeMessageSheet, onDecline]);

  const handleSendQuickMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      stopVibration();
      closeMessageSheet();
      webRTCService.stopIncomingPreviewStream();
      onMessage?.(trimmed);
      onDecline();
    },
    [stopVibration, closeMessageSheet, onMessage, onDecline],
  );

  const toggleAnswerWithoutVideo = useCallback(() => {
    setAnswerWithoutVideo((prev) => {
      const next = !prev;
      if (next) {
        webRTCService.stopIncomingPreviewStream();
      }
      return next;
    });
  }, []);

  const handleMessageButton = onMessage ? openMessageSheet : undefined;
  const showCameraPreview = !answerWithoutVideo;
  return (
    <View
      style={styles.root}
      accessibilityViewIsModal
      accessibilityLabel={`Incoming video call from ${displayName}`}
    >
      <StatusBar hidden animated />

      <View style={styles.backgroundLayer} pointerEvents="none">
        {photoURL ? (
          <>
            <Image
              source={{ uri: photoURL }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
            <BlurView
              intensity={BLUR_INTENSITY}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          </>
        ) : (
          <LinearGradient
            colors={['#1A1A2E', '#16213E']}
            style={StyleSheet.absoluteFill}
          />
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)']}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </View>

      {showCameraPreview ? (
        <LocalCameraPreview
          enabled
          topInset={insets.top}
          keepPreviewOnUnmountRef={keepPreviewOnUnmountRef}
        />
      ) : null}

      <Animated.View style={[styles.slideContent, { transform: [{ translateY: slideY }] }]}>
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
          <View style={[styles.main, { paddingTop: insets.top + 8 }]}>
            <View style={styles.callerSection}>
              <CallerInfoBlock
                displayName={displayName}
                photoURL={photoURL}
                callType="video"
                avatarSize={VIDEO_AVATAR_SIZE}
                rippleColor="rgba(96, 165, 250, 0.5)"
              />
            </View>

            <View style={styles.footer}>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: answerWithoutVideo }}
                accessibilityLabel="Answer without video"
                onPress={toggleAnswerWithoutVideo}
                style={({ pressed }) => [
                  styles.cameraToggleRow,
                  pressed && styles.cameraTogglePressed,
                ]}
              >
                <Ionicons
                  name="videocam-off-outline"
                  size={18}
                  color="rgba(255, 255, 255, 0.7)"
                />
                <Text allowFontScaling={false} style={styles.cameraToggleText}>
                  Answer without video
                </Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>

        <IncomingCallActions
          callType="video"
          onAccept={handleAccept}
          onDecline={handleDecline}
          onMessage={handleMessageButton}
        />
      </Animated.View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  slideContent: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  main: {
    flex: 1,
  },
  callerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 160,
    zIndex: 90,
    paddingHorizontal: 24,
  },
  cameraToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 18,
    paddingVertical: 6,
  },
  cameraTogglePressed: {
    opacity: 0.75,
  },
  cameraToggleText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  previewPanel: {
    position: 'absolute',
    right: 16,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    zIndex: 30,
    elevation: 12,
  },
  previewVideo: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  previewPlaceholderText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
  },
  previewYouPill: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  previewYouText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
    zIndex: 40,
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
    color: '#16213E',
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
    color: '#16213E',
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

export default memo(VideoIncomingCallUI);
