import { memo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useIncomingRipple } from './useIncomingRipple';

const RIPPLE_SIZE_MULTIPLIERS = [1.0, 1.4, 1.8] as const;

export type RippleRingsProps = {
  size: number;
  color: string;
  active?: boolean;
};

function RippleRingsComponent({ size, color, active = true }: RippleRingsProps) {
  const { rippleAnimations } = useIncomingRipple(active);
  const containerSize = size * RIPPLE_SIZE_MULTIPLIERS[RIPPLE_SIZE_MULTIPLIERS.length - 1];

  return (
    <View
      style={[styles.container, { width: containerSize, height: containerSize }]}
      pointerEvents="none"
    >
      {rippleAnimations.map((anim, index) => {
        const ringSize = size * RIPPLE_SIZE_MULTIPLIERS[index];
        const radius = ringSize / 2;

        return (
          <Animated.View
            key={index}
            style={[
              styles.ring,
              {
                width: ringSize,
                height: ringSize,
                borderRadius: radius,
                borderColor: color,
                opacity: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 0],
                }),
                transform: [
                  {
                    scale: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.6, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
});

export const RippleRings = memo(RippleRingsComponent);
export default RippleRings;
