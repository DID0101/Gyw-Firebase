import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import Button from './Button';

const themes = [
  { value: 'light' as const, label: 'settings.lightMode' },
  { value: 'dark' as const, label: 'settings.darkMode' },
  { value: 'system' as const, label: 'settings.systemMode' },
];

interface ThemeToggleProps {
  variant?: 'button' | 'menu' | 'profile';
}

const ThemeToggle = ({ variant = 'button' }: ThemeToggleProps) => {
  const { theme, setTheme, colorScheme } = useTheme();
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);

  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    await setTheme(newTheme);
    setModalVisible(false);
  };

  const currentThemeLabel = themes.find((t) => t.value === theme)?.label || 'settings.systemMode';

  if (variant === 'profile') {
    // Simple sun/moon toggle for profile screen
    const toggleBg = useThemeClassName('bg-gray-300', 'bg-blue-600');
    
    const handleToggle = async () => {
      // Toggle between light and dark (skip system mode)
      const newTheme = colorScheme === 'dark' ? 'light' : 'dark';
      await setTheme(newTheme);
    };

    return (
      <Button variant="plain" onPress={handleToggle}>
        <View className="flex-row items-center gap-3 py-2">
          <Feather name="sun" size={22} color={colorScheme === 'light' ? '#f59e0b' : '#9ca3af'} />
          <View className={`w-14 h-7 rounded-full ${toggleBg} justify-center px-1`}>
            <View 
              style={{
                transform: [{ translateX: colorScheme === 'dark' ? 28 : 0 }],
              }}
              className="w-5 h-5 rounded-full bg-white"
            />
          </View>
          <Feather name="moon" size={22} color={colorScheme === 'dark' ? '#60a5fa' : '#9ca3af'} />
        </View>
      </Button>
    );
  }

  if (variant === 'menu') {
    const textColor = useThemeClassName('text-gray-900', 'text-gray-100');
    const iconBg = useThemeClassName('bg-gray-100', 'bg-gray-800');
    const themeIcon = colorScheme === 'dark' ? 'moon' : 'sun';
    
    return (
      <>
        <Pressable
          className="flex-row items-center gap-4 py-3.5 px-5"
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
          })}
          onPress={() => setModalVisible(true)}
        >
          <View className={clsx('w-9 h-9 rounded-full items-center justify-center', iconBg)}>
            <Feather name={themeIcon} size={18} color="#FF5722" />
          </View>
          <View className="flex-1">
            <Text className={clsx('text-[15px] font-medium', textColor)}>{t('settings.theme')}</Text>
            <Text className={clsx('text-xs opacity-60 mt-0.5', textColor)}>{t(currentThemeLabel)}</Text>
          </View>
        </Pressable>
        <Modal
          transparent
          visible={modalVisible}
          animationType="slide"
          onRequestClose={() => setModalVisible(false)}
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end dark:bg-black/70"
            onPress={() => setModalVisible(false)}
          >
            <View className="bg-white dark:bg-gray-900 rounded-t-3xl p-6">
              <Text className="text-xl font-semibold mb-4 text-black dark:text-white">
                {t('settings.selectTheme')}
              </Text>
              {themes.map((themeOption) => (
                <Pressable
                  key={themeOption.value}
                  onPress={() => handleThemeChange(themeOption.value)}
                  className={`py-4 px-4 rounded-lg mb-2 ${
                    theme === themeOption.value
                      ? 'bg-[#FF5722]/10 dark:bg-[#FF5722]/20'
                      : 'bg-gray-50 dark:bg-gray-800'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className={`text-base ${
                        theme === themeOption.value
                          ? 'font-semibold'
                          : 'text-gray-800 dark:text-gray-200'
                      }`}
                    >
                      {t(themeOption.label)}
                    </Text>
                    {theme === themeOption.value && (
                      <Feather name="check" size={20} color="#FF5722" />
                    )}
                  </View>
                </Pressable>
              ))}
              <Button
                variant="text"
                className="mt-4"
                onPress={() => setModalVisible(false)}
              >
                <Text className="text-gray-600 dark:text-gray-400">{t('common.cancel')}</Text>
              </Button>
            </View>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <>
      <Button variant="text" onPress={() => setModalVisible(true)}>
        <Feather
          name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'smartphone'}
          size={20}
          color="currentColor"
        />
      </Button>
      <Modal
        transparent
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end dark:bg-black/70"
          onPress={() => setModalVisible(false)}
        >
          <View className="bg-white dark:bg-gray-900 rounded-t-3xl p-6">
            <Text className="text-xl font-semibold mb-4 text-black dark:text-white">
              {t('settings.selectTheme')}
            </Text>
            {themes.map((themeOption) => (
              <Pressable
                key={themeOption.value}
                onPress={() => handleThemeChange(themeOption.value)}
                className={`py-4 px-4 rounded-lg mb-2 ${
                  theme === themeOption.value
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <Text
                    style={theme === themeOption.value ? { color: '#FF5722' } : undefined}
                    className={`text-base ${
                      theme === themeOption.value
                        ? 'font-semibold'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {t(themeOption.label)}
                  </Text>
                  {theme === themeOption.value && (
                    <Feather name="check" size={20} color={theme === 'dark' ? '#60a5fa' : '#2563eb'} />
                  )}
                </View>
              </Pressable>
            ))}
            <Button
              variant="text"
              className="mt-4"
              onPress={() => setModalVisible(false)}
            >
              <Text className="text-gray-600 dark:text-gray-400">{t('common.cancel')}</Text>
            </Button>
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

export default ThemeToggle;

