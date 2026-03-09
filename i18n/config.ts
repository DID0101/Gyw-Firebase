import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ru from './locales/ru.json';
import tk from './locales/tk.json';
import tr from './locales/tr.json';

const LANGUAGE_KEY = '@app_language';

// Get device language
const getDeviceLanguage = () => {
  const deviceLanguage = Localization.getLocales()[0]?.languageCode || 'en';
  if (['tr', 'tk', 'ru'].includes(deviceLanguage)) {
    return deviceLanguage;
  }
  return 'en';
};

// Initialize i18n
i18n.use(initReactI18next).init({
  showSupportNotice: false,
  compatibilityJSON: 'v4',
  resources: {
    en: { translation: en },
    tr: { translation: tr },
    tk: { translation: tk },
    ru: { translation: ru },
  },
  lng: getDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  ...(process.env.NODE_ENV === 'development' && {
    missingKeyHandler: (_lngs: string | string[], _ns: string, key: string) => {
      console.warn(`[i18n] Missing key: "${key}"`);
    },
  }),
});

// Load saved language
AsyncStorage.getItem(LANGUAGE_KEY).then((savedLanguage) => {
  if (savedLanguage && ['en', 'tr', 'tk', 'ru'].includes(savedLanguage)) {
    i18n.changeLanguage(savedLanguage);
  }
});

export const changeLanguage = async (language: 'en' | 'tr' | 'tk' | 'ru') => {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
  i18n.changeLanguage(language);
};

export default i18n;

