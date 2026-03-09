import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useColorScheme } from 'react-native';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  colorScheme: 'light' | 'dark';
  isDark: boolean;
  setTheme: (theme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@app_theme';

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const systemColorSchemeRaw = useColorScheme();
  const [theme, setThemeState] = useState<Theme>('system');
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('light');
  const initialized = useRef(false);
  const prevSystemRef = useRef<string | null | undefined>(systemColorSchemeRaw);
  const prevThemeRef = useRef<Theme>('system');

  // Initialize theme once on mount
  useEffect(() => {
    if (initialized.current) return;
    
    const init = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        const finalTheme: Theme = (stored === 'light' || stored === 'dark' || stored === 'system') 
          ? (stored as Theme) 
          : 'system';
        
        if (finalTheme !== 'system') {
          setThemeState(finalTheme);
          prevThemeRef.current = finalTheme;
          setColorScheme(finalTheme);
        } else {
          const scheme = systemColorSchemeRaw || 'light';
          setColorScheme(scheme);
          prevSystemRef.current = systemColorSchemeRaw;
        }
        initialized.current = true;
      } catch (err) {
        if (__DEV__) console.error('Theme init error:', err);
        setColorScheme(systemColorSchemeRaw || 'light');
        initialized.current = true;
      }
    };
    
    init();
  }, [systemColorSchemeRaw]);

  // Update when theme or system scheme changes (after init)
  useEffect(() => {
    if (!initialized.current) return;

    const target = theme === 'system' 
      ? (systemColorSchemeRaw || 'light')
      : theme;

    // Check if update needed
    const systemChanged = theme === 'system' && prevSystemRef.current !== systemColorSchemeRaw;
    const themeChanged = theme !== 'system' && prevThemeRef.current !== theme;
    
    if (!systemChanged && !themeChanged) return;

    // Update refs
    if (theme === 'system') {
      prevSystemRef.current = systemColorSchemeRaw;
    } else {
      prevThemeRef.current = theme;
    }

    // Update state only if different
    setColorScheme(prev => prev === target ? prev : target);
  }, [theme, systemColorSchemeRaw]);


  const setTheme = useCallback(async (newTheme: Theme) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, newTheme);
      setThemeState(newTheme);
    } catch (error) {
      console.error('Error saving theme:', error);
    }
  }, []);

  const isDark = colorScheme === 'dark';

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({ theme, colorScheme, isDark, setTheme }),
    [theme, colorScheme, isDark, setTheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

