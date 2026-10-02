import { Ionicons } from '@expo/vector-icons';
import { memo, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

export type CallActionButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  backgroundColor: string;
  iconColor?: string;
  size?: number;
  onPress: () => void;
  style?: ViewStyle;
  iconStyle?: StyleProp<TextStyle>;
  testID?: string;
};

function CallActionButtonComponent({
  icon,
  label,
  backgroundColor,
  iconColor = '#ffffff',
  size = 72,
  onPress,
  style,
  iconStyle,
  testID,
}: CallActionButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressRipple = useRef(new Animated.Value(0)).current;
  const iconSize = Math.round(size * 0.44);

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.93,
      friction: 6,
      tension: 280,
      useNativeDriver: true,
    }).start();
    pressRipple.setValue(0.35);
    Animated.timing(pressRipple, {
      toValue: 0,
      duration: 420,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      tension: 280,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[styles.wrapper, style]}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={label}
          activeOpacity={1}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          testID={testID}
          style={[
            styles.button,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor,
            },
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              styles.pressRipple,
              {
                borderRadius: size / 2,
                opacity: pressRipple,
              },
            ]}
          />
          <Ionicons
            name={icon}
            size={iconSize}
            color={iconColor}
            style={iconStyle}
          />
        </TouchableOpacity>
      </Animated.View>
      <Text allowFontScaling={false} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    gap: 10,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressRipple: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  label: {
    fontSize: 12,
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.8)',
  },
});

export const CallActionButton = memo(CallActionButtonComponent);
export default CallActionButton;
