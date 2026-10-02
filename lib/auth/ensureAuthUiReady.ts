import { AppState, InteractionManager } from 'react-native';

/** Wait until the sign-in Activity is foregrounded (RN Firebase needs getCurrentActivity()). */
export function ensureAuthUiReady(): Promise<void> {
  return new Promise((resolve) => {
    const run = () => {
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => resolve());
      });
    };

    if (AppState.currentState === 'active') {
      run();
      return;
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sub.remove();
        run();
      }
    });
  });
}
