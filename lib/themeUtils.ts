import { useTheme } from '@/contexts/ThemeContext';

/**
 * Utility function to get theme-aware className
 * Since NativeWind v4's dark: variant relies on React Native's useColorScheme
 * which can't be overridden, we use conditional className application instead
 */
export const cn = (lightClass: string, darkClass: string) => {
  // This will be called at render time, so we need to use it in components
  // For now, return a function that components can call
  return { lightClass, darkClass };
};

/**
 * Hook to get current theme-aware className
 * Usage: const className = useThemeClassName('bg-white', 'bg-gray-900');
 */
export const useThemeClassName = (lightClass: string, darkClass: string) => {
  const { isDark } = useTheme();
  return isDark ? darkClass : lightClass;
};

