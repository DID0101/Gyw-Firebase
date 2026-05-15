import { InteractionManager } from 'react-native';

type IdleFn = () => void;

/**
 * Runs work after the current interaction/transition window.
 * Prefer this over setTimeout(0) for post-navigation tasks.
 */
export function runAfterInteractions(task: IdleFn): { cancel: () => void } {
  const handle = InteractionManager.runAfterInteractions(() => {
    try {
      task();
    } catch {
      /* non-fatal */
    }
  });
  return { cancel: () => handle.cancel?.() };
}

/**
 * Best-effort idle scheduling (RN has no requestIdleCallback).
 * Uses a short delay so the JS thread can finish the current frame & gestures.
 */
export function runOnIdle(task: IdleFn, delayMs: number = 48): { cancel: () => void } {
  const id = setTimeout(() => {
    try {
      task();
    } catch {
      /* non-fatal */
    }
  }, delayMs);
  return { cancel: () => clearTimeout(id) };
}
