import { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  Keyboard,
  NativeModules,
  Platform,
  type LayoutChangeEvent,
} from 'react-native';

type WindowKeyboardDiagnostics = {
  softInputMode: string;
  windowVisibleFrameHeight: number;
  windowVisibleFrameTop: number;
  windowVisibleFrameBottom: number;
  decorFitsSystemWindows: boolean;
};

const RESIZE_THRESHOLD_PX = 48;

/**
 * Dev-only probe: proves whether Android adjustResize shrinks the window vs keyboard overlay.
 * Logs WINDOW_RESIZE_DETECTED=true only when layout/window height actually drops.
 */
const noopLayout = () => {};

export function useChatWindowResizeProbe(active: boolean) {
  const baselineRef = useRef({
    windowHeight: 0,
    rootHeight: 0,
    flatListHeight: 0,
  });
  const metricsRef = useRef({
    rootHeight: 0,
    flatListHeight: 0,
    composerY: 0,
    composerHeight: 0,
  });

  const emitResizeReport = useCallback((reason: string, keyboardHeight = 0) => {
    if (!__DEV__ || Platform.OS !== 'android') return;

    const window = Dimensions.get('window');
    const screen = Dimensions.get('screen');
    const baseline = baselineRef.current;
    const metrics = metricsRef.current;

    const windowDelta =
      baseline.windowHeight > 0 ? baseline.windowHeight - window.height : 0;
    const rootDelta =
      baseline.rootHeight > 0 ? baseline.rootHeight - metrics.rootHeight : 0;
    const flatDelta =
      baseline.flatListHeight > 0
        ? baseline.flatListHeight - metrics.flatListHeight
        : 0;

    const resizeDetected =
      windowDelta >= RESIZE_THRESHOLD_PX ||
      rootDelta >= RESIZE_THRESHOLD_PX ||
      flatDelta >= RESIZE_THRESHOLD_PX;

    console.log('WINDOW_RESIZE_DETECTED', resizeDetected, { reason });
    console.log('ROOT_LAYOUT_HEIGHT', {
      height: Math.round(metrics.rootHeight),
      deltaFromBaseline: Math.round(rootDelta),
    });
    console.log('FLATLIST_LAYOUT_HEIGHT', {
      height: Math.round(metrics.flatListHeight),
      deltaFromBaseline: Math.round(flatDelta),
    });
    console.log('COMPOSER_LAYOUT_Y', {
      y: Math.round(metrics.composerY),
      height: Math.round(metrics.composerHeight),
    });
    console.log('KEYBOARD_HEIGHT', { height: Math.round(keyboardHeight) });
    console.log('WINDOW_VISIBLE_FRAME', {
      windowHeight: Math.round(window.height),
      screenHeight: Math.round(screen.height),
      windowDeltaFromBaseline: Math.round(windowDelta),
    });

    const bridge = NativeModules.IncomingCallBridge as {
      getWindowKeyboardDiagnostics?: () => Promise<WindowKeyboardDiagnostics>;
    } | undefined;
    void bridge?.getWindowKeyboardDiagnostics?.().then((diag) => {
      if (diag) {
        console.log('WINDOW_SOFT_INPUT_MODE', {
          mode: diag.softInputMode,
          visibleFrameHeight: diag.windowVisibleFrameHeight,
          decorFitsSystemWindows: diag.decorFitsSystemWindows,
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!active || Platform.OS !== 'android' || !__DEV__) return;

    baselineRef.current = {
      windowHeight: Dimensions.get('window').height,
      rootHeight: 0,
      flatListHeight: 0,
    };

    const bridge = NativeModules.IncomingCallBridge as {
      getWindowKeyboardDiagnostics?: () => Promise<WindowKeyboardDiagnostics>;
    } | undefined;
    void bridge?.getWindowKeyboardDiagnostics?.().then((diag) => {
      if (diag) {
        console.log('WINDOW_SOFT_INPUT_MODE', {
          mode: diag.softInputMode,
          visibleFrameHeight: diag.windowVisibleFrameHeight,
          decorFitsSystemWindows: diag.decorFitsSystemWindows,
          note: 'KeyboardProvider removed — expect adjustResize',
        });
      }
    });

    const dimSub = Dimensions.addEventListener('change', ({ window }) => {
      emitResizeReport('dimensions_change', 0);
      if (__DEV__) {
        console.log('CHAT_ROOT_HEIGHT', { viewportHeight: Math.round(window.height) });
      }
    });

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const kbH = event.endCoordinates?.height ?? 0;
      console.log('CHAT_KEYBOARD_OPEN', { keyboardHeight: Math.round(kbH) });
      emitResizeReport('keyboard_did_show', kbH);
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      console.log('CHAT_KEYBOARD_CLOSE');
      baselineRef.current.windowHeight = Dimensions.get('window').height;
      emitResizeReport('keyboard_did_hide', 0);
    });

    return () => {
      dimSub.remove();
      showSub.remove();
      hideSub.remove();
    };
  }, [active, emitResizeReport]);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    if (!active) return;
    const { height } = e.nativeEvent.layout;
    metricsRef.current.rootHeight = height;
    if (baselineRef.current.rootHeight <= 0) {
      baselineRef.current.rootHeight = height;
    }
  }, [active]);

  const onFlatListLayout = useCallback((e: LayoutChangeEvent) => {
    if (!active) return;
    const { height } = e.nativeEvent.layout;
    metricsRef.current.flatListHeight = height;
    if (baselineRef.current.flatListHeight <= 0) {
      baselineRef.current.flatListHeight = height;
    }
    if (__DEV__) {
      console.log('FLATLIST_HEIGHT', { height: Math.round(height) });
    }
  }, [active]);

  const onComposerLayout = useCallback((e: LayoutChangeEvent) => {
    if (!active) return;
    const { height, y } = e.nativeEvent.layout;
    metricsRef.current.composerHeight = height;
    metricsRef.current.composerY = y;
    if (__DEV__) {
      console.log('CHAT_INPUT_HEIGHT', { height: Math.round(height) });
      console.log('COMPOSER_Y', { y: Math.round(y) });
    }
  }, [active]);

  if (!active) {
    return {
      onRootLayout: noopLayout,
      onFlatListLayout: noopLayout,
      onComposerLayout: noopLayout,
    };
  }

  return { onRootLayout, onFlatListLayout, onComposerLayout };
}
