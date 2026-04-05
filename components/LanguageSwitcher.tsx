import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';

import { changeLanguage } from '@/i18n/config';
import { useThemeClassName } from '@/lib/themeUtils';
import Button from './Button';

const languages = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'tk', name: 'Türkmen' },
  { code: 'ru', name: 'Русский' },
];

interface LanguageSwitcherProps {
  variant?: 'button' | 'menu';
  initialVisible?: boolean;
  onModalVisibilityChange?: (visible: boolean) => void;
}

const LanguageSwitcher = ({ variant = 'button', initialVisible = false, onModalVisibilityChange }: LanguageSwitcherProps) => {
  const { i18n, t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(initialVisible);
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language);

  // All theme hooks must run every render (Rules of Hooks — do not place inside variant branches).
  const menuTextColor = useThemeClassName('text-gray-900', 'text-gray-100');
  const iconBg = useThemeClassName('bg-gray-100', 'bg-gray-800');
  const buttonTextColor = useThemeClassName('text-black', 'text-white');

  // Sync with external visibility control
  useEffect(() => {
    setModalVisible(initialVisible);
  }, [initialVisible]);
  
  // Notify parent of visibility changes
  useEffect(() => {
    onModalVisibilityChange?.(modalVisible);
  }, [modalVisible, onModalVisibilityChange]);
  
  // Update internal state when modal is closed
  const handleClose = () => {
    setModalVisible(false);
    onModalVisibilityChange?.(false);
  };

  // Sync currentLanguage with i18n.language when it changes
  useEffect(() => {
    setCurrentLanguage(i18n.language);
  }, [i18n.language]);

  const handleLanguageChange = async (languageCode: string) => {
    await changeLanguage(languageCode as 'en' | 'tr' | 'tk' | 'ru');
    setCurrentLanguage(languageCode);
    handleClose();
  };

  const currentLangName = languages.find((lang) => lang.code === currentLanguage)?.name || 'English';

  if (variant === 'menu') {
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
            <Feather name="globe" size={18} color="#337E84" />
          </View>
          <View className="flex-1">
            <Text className={clsx('text-[15px] font-medium', menuTextColor)}>{t('settings.language')}</Text>
            <Text className={clsx('text-xs opacity-60 mt-0.5', menuTextColor)}>{currentLangName}</Text>
          </View>
        </Pressable>
        <Modal
          transparent
          visible={modalVisible}
          animationType="slide"
          onRequestClose={handleClose}
        >
          <Pressable
            className="flex-1 bg-black/50 dark:bg-black/70 justify-end"
            onPress={handleClose}
          >
            <View className="bg-white dark:bg-gray-900 rounded-t-3xl p-6">
              <Text className="text-xl font-semibold mb-4 text-black dark:text-white">{t('settings.selectLanguage')}</Text>
              {languages.map((lang) => (
                <Pressable
                  key={lang.code}
                  onPress={() => handleLanguageChange(lang.code)}
                  className={`py-4 px-4 rounded-lg mb-2 ${
                    currentLanguage === lang.code ? 'bg-[#337E84]/10 dark:bg-[#337E84]/20' : 'bg-gray-50 dark:bg-gray-800'
                  }`}
                >
                  <Text
                    style={currentLanguage === lang.code ? { color: '#337E84' } : undefined}
                    className={`text-base ${
                      currentLanguage === lang.code ? 'font-semibold' : 'text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {lang.name}
                  </Text>
                </Pressable>
              ))}
              <Button
                variant="text"
                className="mt-4"
                onPress={handleClose}
              >
                <Text className="text-gray-600 dark:text-gray-400">{t('common.cancel')}</Text>
              </Button>
            </View>
          </Pressable>
        </Modal>
      </>
    );
  }

  // If initialVisible is provided, we're being controlled externally - don't render the button
  if (initialVisible !== undefined) {
    return (
      <Modal
          transparent
          visible={modalVisible}
          animationType="slide"
          onRequestClose={handleClose}
        >
          <Pressable
            className="flex-1 bg-black/50 dark:bg-black/70 justify-end"
            onPress={handleClose}
          >
          <View className="bg-white dark:bg-gray-900 rounded-t-3xl p-6">
            <Text className="text-xl font-semibold mb-4 text-black dark:text-white">{t('settings.selectLanguage')}</Text>
            {languages.map((lang) => (
              <Pressable
                key={lang.code}
                onPress={() => handleLanguageChange(lang.code)}
                className={`py-4 px-4 rounded-lg mb-2 ${
                  currentLanguage === lang.code ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <Text
                  style={currentLanguage === lang.code ? { color: '#337E84' } : undefined}
                  className={`text-base ${
                    currentLanguage === lang.code ? 'font-semibold' : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {lang.name}
                </Text>
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
    );
  }
  
  // Default button variant when not controlled externally
  return (
    <>
      <Button variant="text" onPress={() => {
        setModalVisible(true);
        onModalVisibilityChange?.(true);
      }}>
        <Text className={clsx('text-base', buttonTextColor)}>{currentLangName}</Text>
      </Button>
      <Modal
        transparent
        visible={modalVisible}
        animationType="slide"
        onRequestClose={handleClose}
      >
        <Pressable
          className="flex-1 bg-black/50 dark:bg-black/70 justify-end"
          onPress={handleClose}
        >
          <View className="bg-white dark:bg-gray-900 rounded-t-3xl p-6">
            <Text className="text-xl font-semibold mb-4 text-black dark:text-white">{t('settings.selectLanguage')}</Text>
            {languages.map((lang) => (
              <Pressable
                key={lang.code}
                onPress={() => handleLanguageChange(lang.code)}
                className={`py-4 px-4 rounded-lg mb-2 ${
                  currentLanguage === lang.code ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <Text
                  style={currentLanguage === lang.code ? { color: '#337E84' } : undefined}
                  className={`text-base ${
                    currentLanguage === lang.code ? 'font-semibold' : 'text-gray-800 dark:text-gray-200'
                  }`}
                >
                  {lang.name}
                </Text>
              </Pressable>
            ))}
            <Button
              variant="text"
              className="mt-4"
              onPress={handleClose}
            >
              <Text className="text-gray-600 dark:text-gray-400">{t('common.cancel')}</Text>
            </Button>
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

export default LanguageSwitcher;

