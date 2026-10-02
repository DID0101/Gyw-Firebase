import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  logLanguageChange,
  logTranslationKeyMissing,
  probeTranslationKey,
} from '@/lib/debug/productionDiagnostics';

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
  missingKeyHandler: (lngs: readonly string[], _ns: string, key: string) => {
    const lng = lngs[0] ?? i18n.language;
    if (__DEV__) {
      console.warn(`[i18n] Missing key: "${key}" (${lng})`);
    }
    logTranslationKeyMissing(key, lng);
  },
});

i18n.on('languageChanged', (lng) => {
  logLanguageChange('event', lng, 'i18n.languageChanged');
});

// Load saved language
AsyncStorage.getItem(LANGUAGE_KEY).then((savedLanguage) => {
  if (savedLanguage && ['en', 'tr', 'tk', 'ru'].includes(savedLanguage)) {
    const prev = i18n.language;
    logLanguageChange(prev, savedLanguage, 'AsyncStorage.hydrate');
    void i18n.changeLanguage(savedLanguage);
  }
});

export const changeLanguage = async (language: 'en' | 'tr' | 'tk' | 'ru') => {
  const prev = i18n.language;
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
  logLanguageChange(prev, language, 'changeLanguage');
  await i18n.changeLanguage(language);
};

/** Logs TRANSLATION_KEY_MISSING in release when key absent from active locale bundle. */
export function tWithProbe(key: string): string {
  const lng = i18n.language;
  if (!probeTranslationKey(key, lng) && lng !== 'en') {
    logTranslationKeyMissing(key, lng);
  }
  return i18n.t(key);
}

export default i18n;

