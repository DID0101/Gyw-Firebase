import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import clsx from 'clsx';

interface TypingIndicatorProps {
  name: string;
  visible: boolean;
  isDark?: boolean;
}

const Dot = ({ delay = 0 }: { delay?: number }) => {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 300 }),
          withTiming(0.3, { duration: 300 })
        ),
        -1,
        true
      )
    );
  }, [delay]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      style={[
        { width: 6, height: 6, borderRadius: 3, marginHorizontal: 2 },
        animatedStyle,
      ]}
      className="bg-gray-500"
    />
  );
};

export const TypingIndicator = ({ name, visible, isDark }: TypingIndicatorProps) => {
  if (!visible) return null;

  return (
    <View
      className={clsx(
        'flex-row items-center px-4 py-2 mx-4 mb-2 rounded-2xl self-start',
        isDark ? 'bg-gray-700' : 'bg-gray-200'
      )}
    >
      <View className="flex-row items-center mr-2">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </View>
      <Text className={clsx('text-sm', isDark ? 'text-gray-300' : 'text-gray-600')}>
        {name} is typing...
      </Text>
    </View>
  );
};

export default TypingIndicator;
