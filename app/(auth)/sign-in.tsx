import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import { useThemeClassName } from '@/lib/themeUtils';
import {
  sendPhoneOTP,
  confirmPhoneOTP,
  friendlyAuthError,
  restorePhoneLoginSession,
  compatSavePendingLogin,
  loadPendingLoginIfFresh,
  clearPendingLogin,
  compatSignOut,
} from '@/lib/auth/authCompat';
import { assertPhoneAllowedForAuth } from '@/lib/auth/phoneRegistrationCheck';
import { clearServerOtpSession } from '@/lib/auth/phoneOtpSessionStore';
import { hasCompleteProfileForSignIn } from '@/lib/auth/userProfileRead';
import { waitForAuthToken } from '@/lib/auth/waitForAuthToken';
import { getNetworkQuality } from '@/lib/reliability/NetworkManager';
import { useProductionScreenTrace } from '@/lib/hooks/useProductionScreenTrace';
import { navigateOnce } from '@/lib/safeAction';
import { trackLogin } from '@/lib/services/analyticsService';
import { crashlyticsLog } from '@/lib/services/crashlyticsService';

function formatPhone(text: string): string {
  const cleaned = text.replace(/[^\d+]/g, '');
  return cleaned && !cleaned.startsWith('+') ? '+' + cleaned : cleaned;
}

const SignInScreen = () => {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  useProductionScreenTrace('SignIn', { lang: i18n.language });
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const languagePillBg = useThemeClassName('bg-white/90', 'bg-gray-800/90');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const [phone, setPhone] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadPendingLoginIfFresh().then((saved) => {
        if (cancelled) return;
        if (!saved?.verificationId) {
          setVerificationId(null);
          setCode('');
          return;
        }
        restorePhoneLoginSession(saved);
        setPhone(saved.phone);
        setVerificationId(saved.verificationId);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'tk', name: 'Türkmen' },
    { code: 'ru', name: 'Русский' },
  ];
  const currentLangName = languages.find((l) => l.code === i18n.language)?.name ?? 'English';

  const sendOTP = async () => {
    const formatted = formatPhone(phone);
    if (!formatted.startsWith('+') || formatted.length < 8) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterPhone'));
      return;
    }
    if (!getNetworkQuality().isOnline) {
      Alert.alert(t('auth.error'), friendlyAuthError({ code: 'network/offline' }));
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      await assertPhoneAllowedForAuth(formatted, 'signIn');
      const vid = await sendPhoneOTP(formatted);
      setPhone(formatted);
      setVerificationId(vid);
      await compatSavePendingLogin({
        phone: formatted,
        verificationId: vid,
        savedAt: new Date().toISOString(),
      });
      Alert.alert(t('auth.success'), t('auth.otpSent'));
    } catch (error: any) {
      if (__DEV__) console.warn('OTP send failed:', error?.code ?? error?.message ?? error);
      Alert.alert(t('auth.error'), friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    if (!verificationId || !code || code.length !== 6) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterCode'));
      return;
    }
    setLoading(true);
    try {
      const pending = await loadPendingLoginIfFresh();
      if (pending?.verificationId === verificationId) {
        restorePhoneLoginSession(pending);
      }
      const { uid } = await confirmPhoneOTP(verificationId, code);

      await waitForAuthToken();
      const hasProfile = await hasCompleteProfileForSignIn(uid, phone);
      if (!hasProfile) {
        await compatSignOut();
        await clearPendingLogin();
        setVerificationId(null);
        setCode('');
        Alert.alert(t('auth.error'), t('auth.accountNotRegistered'));
        return;
      }

      await AsyncStorage.setItem(`profileCompleteCache:v1:${uid}`, '1');

      crashlyticsLog(`user_login uid=${uid.slice(0, 8)}`);
      void trackLogin('phone');

      await clearPendingLogin();
      await clearServerOtpSession();
      navigateOnce(router, 'replace', '/(home)/(tabs)/chats');
    } catch (error: any) {
      if (__DEV__) console.warn('OTP verify failed:', error?.code ?? error?.message ?? error);
      const msg = friendlyAuthError(error);
      const code_ = error?.code ?? '';
      if (code_ === 'auth/code-expired' || code_ === 'auth/session-expired') {
        setVerificationId(null);
        setCode('');
      }
      Alert.alert(t('auth.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  const resetToPhone = () => {
    setVerificationId(null);
    setCode('');
    setPhone('');
    void clearPendingLogin();
  };

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      {/* Language switcher */}
      <View className="absolute top-8 right-4 z-10">
        <Pressable
          onPress={() => setShowLanguageModal(true)}
          className={clsx(
            'flex-row items-center gap-2.5 px-3.5 py-2 rounded-full',
            languagePillBg,
            'shadow-sm',
          )}
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <Feather name="globe" size={16} color="#FF5722" />
          <Text className={clsx('text-sm font-medium', textColor)}>{currentLangName}</Text>
        </Pressable>
        <LanguageSwitcher
          initialVisible={showLanguageModal}
          onModalVisibilityChange={setShowLanguageModal}
        />
      </View>

      {/* Heading */}
      <View className="gap-3">
        <Text className={clsx('text-center text-3xl font-semibold', textColor)}>
          {t('auth.signIn')}
        </Text>
        <Text className={clsx('text-center text-base', textSecondaryColor)}>
          {verificationId ? t('auth.enterCode') : t('auth.enterPhoneNumber')}
        </Text>
      </View>

      {/* Phone step */}
      {!verificationId && (
        <>
          <TextField
            testID="auth-phone-input"
            value={phone}
            placeholder={`${t('auth.phoneNumber')} (e.g. +1234567890)`}
            onChangeText={(v) => setPhone(formatPhone(v))}
            keyboardType="phone-pad"
            autoComplete="off"
            textContentType="none"
          />
          <Button testID="auth-send-otp" onPress={sendOTP}>{t('auth.sendOTP')}</Button>
        </>
      )}

      {/* OTP step */}
      {verificationId && (
        <>
          <Text className={clsx('text-sm text-center', textSecondaryColor)}>
            {t('auth.enterCodeSentTo')} {phone}
          </Text>
          <TextField
            value={code}
            placeholder={t('auth.enterCode')}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <Button testID="auth-verify-otp" onPress={verifyOTP}>{t('common.verify')}</Button>
          <Pressable onPress={resetToPhone}>
            <Text className="text-center text-[#FF5722]">{t('auth.wrongPhone')}</Text>
          </Pressable>
        </>
      )}

      {/* Sign up link */}
      <View className="flex-row gap-[3px]">
        <Text>{t('auth.dontHaveAccount')}</Text>
        <Link href="/sign-up">
          <Text style={{ color: '#FF5722' }}>{t('auth.signUp')}</Text>
        </Link>
      </View>

      {/* Hidden reCAPTCHA anchor (web invisible OTP) */}
      {Platform.OS === 'web' && !verificationId && (
        <View
          nativeID="recaptcha-container"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        />
      )}
    </Screen>
  );
};

export default SignInScreen;
