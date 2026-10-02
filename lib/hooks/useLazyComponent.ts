import { useEffect, useRef, useState, type ComponentType } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Load a heavy screen module after interactions (Android low-end route diet).
 */
export function useLazyComponent<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  shouldLoad: boolean
): ComponentType<P> | null {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!shouldLoad || Component) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void loaderRef.current().then((mod) => {
        setComponent(() => mod.default);
      });
    });
    return () => task.cancel?.();
  }, [shouldLoad, Component]);

  return Component;
}
