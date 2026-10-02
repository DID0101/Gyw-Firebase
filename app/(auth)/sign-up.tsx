import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';

import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import {
  clearPendingSignup,
  loadPendingSignupIfFresh,
  savePendingSignup,
  type PendingProfile,
} from '@/lib/auth/pendingSignupState';
import {
  checkUsernameAvailableStrict,
  writeUserDocReliable,
} from '@/lib/auth/userProfileWrite';
import { useThemeClassName } from '@/lib/themeUtils';
import { navigateOnce } from '@/lib/safeAction';
import { getNetworkQuality } from '@/lib/reliability/NetworkManager';
import { getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';
import { sendPhoneOTP, confirmPhoneOTP, friendlyAuthError, compatSignOut, getPhoneOtpSessionForPersistence, restorePhoneLoginSession } from '@/lib/auth/authCompat';
import { assertPhoneAllowedForAuth } from '@/lib/auth/phoneRegistrationCheck';
import { isCompleteUserProfile, readUserProfileByUid } from '@/lib/auth/userProfileRead';
import {
  buildDisplayName,
  prepareUserDocFields,
  validateSignupProfileFields,
} from '@/lib/unicodeText';
import useUserForm from '@/hooks/useUserForm';
import { waitForAuthToken } from '@/lib/auth/waitForAuthToken';
import { crashlyticsLog } from '@/lib/services/crashlyticsService';

type Step = 'form' | 'otp';

function formatPhone(text: string): string {
  const cleaned = text.replace(/[^\d+]/g, '');
  return cleaned && !cleaned.startsWith('+') ? '+' + cleaned : cleaned;
}

function buildUserDoc(uid: string, phone: string, firstName: string, lastName: string, username: string) {
  return prepareUserDocFields({
    uid,
    phoneNumber: phone,
    firstName,
    lastName,
    username,
    photoURL: '',
    bio: '',
  });
}

async function writeUserDoc(uid: string, data: Record<string, any>) {
  await writeUserDocReliable(uid, data);
}

const SignUpScreen = () => {
  const router = useRouter();
  const params = useLocalSearchParams<{ completeProfile?: string; phone?: string }>();
  const { user: authUser } = useAuth();
  const { t, i18n } = useTranslation();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const hintTextColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const isCompleteProfile = params.completeProfile === '1' && !!authUser;

  const [step, setStep] = useState<Step>('form');
  const [phone, setPhone] = useState(params.phone ?? authUser?.phoneNumber ?? '');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);

  // Saved between form → OTP step
  const [pendingProfile, setPendingProfile] = useState<PendingProfile | null>(null);

  const { firstName, lastName, username, usernameNumber, numberError,
          onChangeFirstName, onChangeLastName, onChangeUsername, onChangeNumber } = useUserForm();

  useEffect(() => {
    if (isCompleteProfile) return;
    void (async () => {
      const saved = await loadPendingSignupIfFresh();
      if (saved) {
        setStep(saved.step);
        setPhone(saved.phone);
        setVerificationId(saved.verificationId);
        setPendingProfile(saved.pendingProfile);
        if (saved.verificationId && saved.mode === 'server' && saved.sessionInfo) {
          restorePhoneLoginSession({
            phone: saved.phone,
            verificationId: saved.verificationId,
            mode: saved.mode,
            sessionInfo: saved.sessionInfo,
          });
        }
        return;
      }
      const stale = await loadPendingSignup();
      if (stale?.step === 'otp' && stale.verificationId) {
        Alert.alert(t('auth.error'), t('auth.sessionExpired'));
      }
    })();
  }, [isCompleteProfile, t]);

  useEffect(() => {
    if (isCompleteProfile || step !== 'otp') return;
    const otpMeta = getPhoneOtpSessionForPersistence();
    void savePendingSignup({
      step,
      phone,
      verificationId,
      pendingProfile,
      mode: otpMeta?.mode,
      sessionInfo: otpMeta?.sessionInfo,
      savedAt: new Date().toISOString(),
    });
  }, [isCompleteProfile, step, phone, verificationId, pendingProfile]);

  useEffect(() => {
    if (isCompleteProfile && authUser?.phoneNumber) setPhone(authUser.phoneNumber);
  }, [isCompleteProfile, authUser?.phoneNumber]);

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'tk', name: 'Türkmen' },
    { code: 'ru', name: 'Русский' },
  ];
  const currentLangName = languages.find((l) => l.code === i18n.language)?.name ?? 'English';

  // ── Complete Profile (already signed in) ──────────────────────────────────

  const handleCompleteProfile = async () => {
    if (!authUser) return;
    if (numberError) { Alert.alert(t('auth.error'), t('profile.usernameHint')); return; }
    const validated = validateSignupProfileFields(firstName, lastName, username, usernameNumber);
    if (!validated.ok) {
      Alert.alert(t('auth.error'), t('auth.pleaseFillAllFields')); return;
    }
    setLoading(true);
    try {
      const available = await checkUsernameAvailableStrict(validated.finalUsername);
      if (!available) {
        Alert.alert(t('auth.error'), t('auth.usernameTaken')); return;
      }
      const userDoc = buildUserDoc(
        authUser.uid,
        authUser.phoneNumber ?? phone,
        validated.firstName,
        validated.lastName,
        validated.finalUsername,
      );
      await writeUserDoc(authUser.uid, userDoc);

      const displayName = validated.displayName;
      if (Platform.OS === 'web') {
        const { updateProfile } = await import('firebase/auth');
        await updateProfile(authUser as any, { displayName });
      } else if (hasRnFirebase) {
        const nativeUser = getRnAuth()?.currentUser;
        if (nativeUser?.updateProfile) await nativeUser.updateProfile({ displayName });
      }

      await AsyncStorage.setItem('pendingUsername', validated.finalUsername);
      await clearPendingSignup();
      crashlyticsLog(`user_sign_up uid=${authUser.uid.slice(0, 8)}`);
      void trackSignUp('phone');
      Alert.alert(t('auth.success'), t('auth.accountCreated'), [
        { text: 'OK', onPress: () => navigateOnce(router, 'replace', '/(home)/(tabs)/chats') },
      ]);
    } catch (e: any) {
      Alert.alert(t('auth.error'), e?.message ?? t('auth.signUpFailed'));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Form → send OTP ───────────────────────────────────────────────

  const handleFormSubmit = async () => {
    if (isCompleteProfile) { handleCompleteProfile(); return; }

    if (numberError) { Alert.alert(t('auth.error'), t('profile.usernameHint')); return; }
    const validated = validateSignupProfileFields(firstName, lastName, username, usernameNumber);
    if (!validated.ok) {
      Alert.alert(t('auth.error'), t('auth.pleaseFillAllFields')); return;
    }
    const formatted = formatPhone(phone);
    if (!formatted.startsWith('+') || formatted.length < 8) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterPhone')); return;
    }

    if (!getNetworkQuality().isOnline) {
      Alert.alert(t('auth.error'), friendlyAuthError({ code: 'network/offline' }));
      return;
    }

    if (loading) return;
    setLoading(true);
    try {
      await assertPhoneAllowedForAuth(formatted, 'signUp');

      const vid = await sendPhoneOTP(formatted);
      setPhone(formatted);
      setVerificationId(vid);
      setPendingProfile({
        firstName: validated.firstName,
        lastName: validated.lastName,
        username: validated.finalUsername,
        phone: formatted,
      });
      setStep('otp');
      const otpMeta = getPhoneOtpSessionForPersistence();
      await savePendingSignup({
        step: 'otp',
        phone: formatted,
        verificationId: vid,
        mode: otpMeta?.mode,
        sessionInfo: otpMeta?.sessionInfo,
        pendingProfile: {
          firstName: validated.firstName,
          lastName: validated.lastName,
          username: validated.finalUsername,
          phone: formatted,
        },
        savedAt: new Date().toISOString(),
      });
      Alert.alert(t('auth.success'), t('auth.otpSent'));
    } catch (error: any) {
      if (__DEV__) console.error('Error sending OTP:', error);
      Alert.alert(t('auth.error'), friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: OTP → create account ─────────────────────────────────────────

  const handleVerifyOTP = async () => {
    if (!verificationId || !otpCode || otpCode.length !== 6) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterCode')); return;
    }
    if (!pendingProfile) {
      Alert.alert(t('auth.error'), t('auth.sessionExpired'));
      setStep('form'); return;
    }

    setLoading(true);
    try {
      const { uid } = await confirmPhoneOTP(verificationId, otpCode);
      await waitForAuthToken();

      const existingProfile = await readUserProfileByUid(uid);
      if (isCompleteUserProfile(existingProfile)) {
        await compatSignOut();
        await clearPendingSignup();
        setVerificationId(null);
        setOtpCode('');
        setStep('form');
        Alert.alert(t('auth.error'), t('auth.accountAlreadyExists'), [
          { text: 'OK', onPress: () => navigateOnce(router, 'replace', '/sign-in') },
        ]);
        return;
      }

      const userDoc = buildUserDoc(
        uid,
        pendingProfile.phone,
        pendingProfile.firstName,
        pendingProfile.lastName,
        pendingProfile.username,
      );
      const available = await checkUsernameAvailableStrict(pendingProfile.username);
      if (!available) {
        Alert.alert(t('auth.error'), t('auth.usernameTaken'));
        return;
      }

      await writeUserDoc(uid, userDoc);

      const displayName = buildDisplayName(
        pendingProfile.firstName,
        pendingProfile.lastName
      );

      if (Platform.OS === 'web') {
        const { updateProfile, getAuth } = await import('firebase/auth');
        const { auth } = await import('@/lib/firebase');
        const currentUser = getAuth(auth.app).currentUser;
        if (currentUser) await updateProfile(currentUser, { displayName });
      } else if (hasRnFirebase) {
        const nativeUser = getRnAuth()?.currentUser;
        if (nativeUser?.updateProfile) await nativeUser.updateProfile({ displayName });
      }

      await AsyncStorage.setItem('pendingUsername', pendingProfile.username);
      await clearPendingSignup();
      crashlyticsLog(`user_sign_up uid=${uid.slice(0, 8)}`);
      void trackSignUp('phone');
      Alert.alert(t('auth.success'), t('auth.accountCreated'), [
        { text: 'OK', onPress: () => navigateOnce(router, 'replace', '/(home)/(tabs)/chats') },
      ]);
    } catch (error: any) {
      if (__DEV__) console.error('Error verifying OTP:', error);
      const msg = friendlyAuthError(error);
      const c = error?.code ?? '';
      if (c === 'auth/code-expired' || c === 'auth/session-expired') {
        setVerificationId(null); setOtpCode(''); setStep('form');
      }
      Alert.alert(t('auth.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      {/* Language switcher */}
      <View className="absolute top-10 right-4 z-10">
        <Pressable
          onPress={() => setShowLanguageModal(true)}
          className={clsx(
            'flex-row items-center gap-2 px-4 py-2.5 rounded-full',
            useThemeClassName('bg-gray-100', 'bg-gray-800'),
          )}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View className={clsx('w-7 h-7 rounded-full items-center justify-center', useThemeClassName('bg-white', 'bg-gray-700'))}>
            <Feather name="globe" size={14} color="#FF5722" />
          </View>
          <Text className={clsx('text-sm font-semibold', textColor)}>{currentLangName}</Text>
        </Pressable>
        <LanguageSwitcher initialVisible={showLanguageModal} onModalVisibilityChange={setShowLanguageModal} />
      </View>

      {/* Heading */}
      <View className="gap-3">
        <Text className={clsx('text-center text-3xl font-semibold', textColor)}>
          {t('auth.signUp')}
        </Text>
        <Text className={clsx('text-center text-base', textSecondaryColor)}>
          {step === 'form' ? t('auth.createAccount') : t('auth.enterCode')}
        </Text>
      </View>

      {/* Form step */}
      {step === 'form' && (
        <>
          <TextField value={firstName} placeholder={t('auth.firstName')} onChangeText={onChangeFirstName} />
          <TextField value={lastName} placeholder={t('auth.lastName')} onChangeText={onChangeLastName} />
          <View className="relative">
            <TextField
              autoCapitalize="none"
              value={username}
              placeholder={t('auth.username')}
              onChangeText={onChangeUsername}
              className="pr-12"
            />
            <View className="absolute right-3 top-3 flex-row gap-2">
              <View className="w-0.5 h-5 bg-gray-300" />
              <TextInput
                keyboardType="number-pad"
                maxLength={2}
                value={usernameNumber}
                onChangeText={onChangeNumber}
                className="w-5 h-5 android:w-8 android:h-12 android:bottom-3.5"
              />
            </View>
            <Text className={clsx('pl-2 pt-2 text-xs', numberError ? 'text-red-500' : hintTextColor)}>
              {numberError || t('profile.usernameHint')}
            </Text>
          </View>
          <TextField
            value={phone}
            placeholder={`${t('auth.phoneNumber')} (e.g. +1234567890)`}
            onChangeText={(v) => setPhone(formatPhone(v))}
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={!isCompleteProfile}
          />
          <Button onPress={handleFormSubmit}>{t('common.continue')}</Button>
        </>
      )}

      {/* OTP step */}
      {step === 'otp' && (
        <>
          <Text className={clsx('text-sm text-center', textSecondaryColor)}>
            {t('auth.enterCodeSentTo')} {pendingProfile?.phone ?? phone}
          </Text>
          <TextField
            value={otpCode}
            placeholder={t('auth.enterCode')}
            onChangeText={setOtpCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <Button onPress={handleVerifyOTP}>{t('auth.verify')}</Button>
          <Pressable onPress={() => { setStep('form'); setVerificationId(null); setOtpCode(''); void clearPendingSignup(); }}>
            <Text className="text-center text-[#FF5722]">{t('auth.wrongPhoneNumber')}</Text>
          </Pressable>
        </>
      )}

      {/* Sign in link */}
      {!isCompleteProfile && (
        <View className="flex-row gap-[3px]">
          <Text>{t('auth.alreadyHaveAccount')}</Text>
          <Link href="/sign-in">
            <Text style={{ color: '#FF5722' }}>{t('auth.signIn')}</Text>
          </Link>
        </View>
      )}

      {/* Hidden reCAPTCHA anchor (web invisible OTP) */}
      {Platform.OS === 'web' && step === 'form' && (
        <View
          nativeID="recaptcha-container"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        />
      )}
    </Screen>
  );
};

export default SignUpScreen;
