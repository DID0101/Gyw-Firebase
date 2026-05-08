import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import { useThemeClassName } from '@/lib/themeUtils';
import { sendPhoneOTP, confirmPhoneOTP, friendlyAuthError } from '@/lib/phoneAuth';
import { db } from '@/lib/firebase';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

function formatPhone(text: string): string {
  const cleaned = text.replace(/[^\d+]/g, '');
  return cleaned && !cleaned.startsWith('+') ? '+' + cleaned : cleaned;
}

const SignInScreen = () => {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const [phone, setPhone] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    try {
      const vid = await sendPhoneOTP(formatted);
      setPhone(formatted);
      setVerificationId(vid);
      Alert.alert(t('auth.success'), t('auth.otpSent'));
    } catch (error: any) {
      if (__DEV__) console.error('Error sending OTP:', error);
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
      const { uid } = await confirmPhoneOTP(verificationId, code);

      // Check if Firestore profile is complete
      let hasProfile = false;
      try {
        if (Platform.OS !== 'web' && hasRnFirebase) {
          const rnFs = require('@react-native-firebase/firestore');
          const snap = await rnFs.getDoc(rnFs.doc(getRnFirestore(), 'users', uid));
          const d = snap.exists ? snap.data() : null;
          hasProfile = !!(d?.firstName && d?.username);
        } else {
          const { doc, getDoc } = await import('firebase/firestore');
          const snap = await getDoc(doc(db, 'users', uid));
          const d = snap.exists() ? snap.data() : null;
          hasProfile = !!(d?.firstName && d?.username);
        }
      } catch (_) {
        // If we can't check (network/permission), go to chats and let home handle it
        hasProfile = true;
      }

      if (hasProfile) {
        router.replace('/(home)/(tabs)/chats');
      } else {
        router.replace({ pathname: '/sign-up', params: { completeProfile: '1', phone } });
      }
    } catch (error: any) {
      if (__DEV__) console.error('Error verifying OTP:', error);
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
  };

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      {/* Language switcher */}
      <View className="absolute top-8 right-4 z-10">
        <Pressable
          onPress={() => setShowLanguageModal(true)}
          className={clsx(
            'flex-row items-center gap-2.5 px-3.5 py-2 rounded-full',
            useThemeClassName('bg-white/90', 'bg-gray-800/90'),
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
            value={phone}
            placeholder={`${t('auth.phoneNumber')} (e.g. +1234567890)`}
            onChangeText={(v) => setPhone(formatPhone(v))}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Button onPress={sendOTP}>{t('auth.sendOTP')}</Button>
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
          <Button onPress={verifyOTP}>{t('auth.verify')}</Button>
          <Pressable onPress={resetToPhone}>
            <Text className="text-center text-[#FF5722]">{t('auth.wrongPhoneNumber')}</Text>
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

      {/* reCAPTCHA anchor (web only) */}
      {Platform.OS === 'web' && (
        <View
          nativeID="recaptcha-container"
          style={{ display: 'none', position: 'absolute', width: 0, height: 0 }}
        />
      )}
    </Screen>
  );
};

export default SignInScreen;
