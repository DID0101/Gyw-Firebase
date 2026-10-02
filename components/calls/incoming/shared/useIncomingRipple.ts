import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';

const RING_DELAYS_MS = [0, 400, 800] as const;
const PULSE_DURATION_MS = 2000;

function buildRingLoop(anim: Animated.Value, delayMs: number): Animated.CompositeAnimation {
  return Animated.loop(
    Animated.sequence([
      Animated.delay(delayMs),
      Animated.timing(anim, {
        toValue: 1,
        duration: PULSE_DURATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(anim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ])
  );
}

/**
 * Three staggered ripple Animated.Values for incoming-call avatar rings.
 * Each value runs 0→1 (scale 0.6→1, opacity 0.6→0); interpolate in the view layer.
 */
export function useIncomingRipple(active = true) {
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const ripple3 = useRef(new Animated.Value(0)).current;
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  const stopLoops = useCallback(() => {
    loopsRef.current.forEach((loop) => loop.stop());
    loopsRef.current = [];
    ripple1.setValue(0);
    ripple2.setValue(0);
    ripple3.setValue(0);
  }, [ripple1, ripple2, ripple3]);

  const startLoops = useCallback(() => {
    stopLoops();
    const values = [ripple1, ripple2, ripple3];
    loopsRef.current = values.map((anim, i) => {
      const loop = buildRingLoop(anim, RING_DELAYS_MS[i] ?? 0);
      loop.start();
      return loop;
    });
  }, [ripple1, ripple2, ripple3, stopLoops]);

  useEffect(() => {
    if (active) {
      startLoops();
    } else {
      stopLoops();
    }
    return stopLoops;
  }, [active, startLoops, stopLoops]);

  return { rippleAnimations: [ripple1, ripple2, ripple3] };
}
