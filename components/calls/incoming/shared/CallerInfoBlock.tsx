import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { AVATAR_SIZE, CALL_COLORS } from '@/constants/CallTheme';
import { coerceDisplayString, getAvatarInitial } from '@/lib/unicodeText';

import RippleRings from './RippleRings';

export type CallerInfoBlockProps = {
  displayName: string;
  photoURL?: string;
  callType: 'audio' | 'video';
  /** Avatar diameter (default AVATAR_SIZE from CallTheme) */
  avatarSize?: number;
  /** When set, draws animated rings behind the avatar */
  rippleColor?: string;
  style?: ViewStyle;
};

function CallerInfoBlockComponent({
  displayName,
  photoURL,
  callType,
  avatarSize = AVATAR_SIZE,
  rippleColor,
  style,
}: CallerInfoBlockProps) {
  const safeName = coerceDisplayString(displayName);
  const initial = getAvatarInitial(safeName);
  const callLabel =
    callType === 'video' ? 'Incoming video call' : 'Incoming voice call';
  const iconName = callType === 'video' ? 'videocam' : 'mic';
  const iconPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(iconPulse, {
          toValue: 1.2,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(iconPulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [iconPulse]);

  return (
    <View style={[styles.root, style]}>
      <View
        style={[
          styles.avatarStage,
          {
            width: avatarSize * 1.8,
            height: avatarSize * 1.8,
          },
        ]}
      >
        {rippleColor ? (
          <RippleRings size={avatarSize} color={rippleColor} />
        ) : null}
        <View
          style={[
            styles.avatarOuter,
            {
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
            },
          ]}
        >
        {photoURL ? (
          <Image
            source={{ uri: photoURL }}
            style={styles.avatarImage}
            contentFit="cover"
          />
        ) : (
          <View style={styles.initialsCircle}>
            <Text allowFontScaling={false} style={styles.initialsText}>
              {initial}
            </Text>
          </View>
        )}
        </View>
      </View>

      <Text allowFontScaling={false} style={styles.name} numberOfLines={2}>
        {safeName}
      </Text>

      <View style={styles.callTypeRow}>
        <Animated.View style={{ transform: [{ scale: iconPulse }] }}>
          <Ionicons name={iconName} size={16} color={CALL_COLORS.callTypeText} />
        </Animated.View>
        <Text allowFontScaling={false} style={styles.callType}>
          {callLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  avatarStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarOuter: {
    borderWidth: 2,
    borderColor: '#ffffff',
    overflow: 'hidden',
    zIndex: 2,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  initialsCircle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a2a3d',
  },
  initialsText: {
    fontSize: 32,
    fontWeight: '600',
    color: CALL_COLORS.callerNameText,
  },
  name: {
    fontSize: 26,
    fontWeight: '600',
    color: CALL_COLORS.callerNameText,
    textAlign: 'center',
    marginBottom: 8,
  },
  callTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  callType: {
    fontSize: 15,
    color: CALL_COLORS.callTypeText,
  },
});

export const CallerInfoBlock = memo(CallerInfoBlockComponent);
export default CallerInfoBlock;
