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
import { useThemeClassName } from '@/lib/themeUtils';
import { db } from '@/lib/firebase';
import { getRnAuth, getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';
import { sanitizeForFirestore } from '@/lib/firestoreNative';
import { sendPhoneOTP, confirmPhoneOTP, friendlyAuthError } from '@/lib/phoneAuth';
import useUserForm from '@/hooks/useUserForm';

type Step = 'form' | 'otp';

function formatPhone(text: string): string {
  const cleaned = text.replace(/[^\d+]/g, '');
  return cleaned && !cleaned.startsWith('+') ? '+' + cleaned : cleaned;
}

function buildUserDoc(uid: string, phone: string, firstName: string, lastName: string, username: string) {
  const now = new Date().toISOString();
  return {
    uid,
    phoneNumber: phone,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    username,
    photoURL: '',
    bio: '',
    createdAt: now,
    lastSeen: now,
    isOnline: false,
  };
}

async function writeUserDoc(uid: string, data: Record<string, any>) {
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const rnFs = require('@react-native-firebase/firestore');
    await rnFs.setDoc(rnFs.doc(getRnFirestore(), 'users', uid), sanitizeForFirestore(data));
  } else {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'users', uid), data);
  }
}

async function checkUsernameAvailable(username: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'web' && hasRnFirebase) {
      const rnFs = require('@react-native-firebase/firestore');
      const q = rnFs.query(
        rnFs.collection(getRnFirestore(), 'users'),
        rnFs.where('username', '==', username),
        rnFs.limit(1),
      );
      const snap = await rnFs.getDocs(q);
      return snap.empty;
    } else {
      const { collection, getDocs, query, where, limit } = await import('firebase/firestore');
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', username), limit(1)));
      return snap.empty;
    }
  } catch {
    // Permission denied (not yet signed in) — allow and let the server rule catch it
    return true;
  }
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
  const [pendingProfile, setPendingProfile] = useState<{
    firstName: string; lastName: string; username: string; phone: string;
  } | null>(null);

  const { firstName, lastName, username, usernameNumber, numberError,
          onChangeFirstName, onChangeLastName, onChangeUsername, onChangeNumber } = useUserForm();

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
    if (!firstName.trim() || !username.trim() || !usernameNumber) {
      Alert.alert(t('auth.error'), t('auth.pleaseFillAllFields')); return;
    }
    const finalUsername = `${username}_${usernameNumber}`;
    setLoading(true);
    try {
      const userDoc = buildUserDoc(
        authUser.uid,
        authUser.phoneNumber ?? phone,
        firstName, lastName, finalUsername,
      );
      await writeUserDoc(authUser.uid, userDoc);

      const displayName = lastName.trim() ? `${firstName.trim()} ${lastName.trim()}` : firstName.trim();
      if (Platform.OS === 'web') {
        const { updateProfile } = await import('firebase/auth');
        await updateProfile(authUser as any, { displayName });
      } else if (hasRnFirebase) {
        const nativeUser = getRnAuth()?.currentUser;
        if (nativeUser?.updateProfile) await nativeUser.updateProfile({ displayName });
      }

      await AsyncStorage.setItem('pendingUsername', finalUsername);
      Alert.alert(t('auth.success'), t('auth.accountCreated'), [
        { text: 'OK', onPress: () => router.replace('/(home)/(tabs)/chats') },
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
    if (!firstName.trim() || !username.trim() || !usernameNumber) {
      Alert.alert(t('auth.error'), t('auth.pleaseFillAllFields')); return;
    }
    const formatted = formatPhone(phone);
    if (!formatted.startsWith('+') || formatted.length < 8) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterPhone')); return;
    }

    const finalUsername = `${username}_${usernameNumber}`;
    setLoading(true);
    try {
      const available = await checkUsernameAvailable(finalUsername);
      if (!available) {
        Alert.alert(t('auth.error'), t('auth.usernameTaken')); return;
      }

      const vid = await sendPhoneOTP(formatted);
      setPhone(formatted);
      setVerificationId(vid);
      setPendingProfile({ firstName: firstName.trim(), lastName: lastName.trim(), username: finalUsername, phone: formatted });
      setStep('otp');
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

      const userDoc = buildUserDoc(
        uid,
        pendingProfile.phone,
        pendingProfile.firstName,
        pendingProfile.lastName,
        pendingProfile.username,
      );
      await writeUserDoc(uid, userDoc);

      const displayName = pendingProfile.lastName
        ? `${pendingProfile.firstName} ${pendingProfile.lastName}`
        : pendingProfile.firstName;

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
      Alert.alert(t('auth.success'), t('auth.accountCreated'), [
        { text: 'OK', onPress: () => router.replace('/(home)/(tabs)/chats') },
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
          <Pressable onPress={() => { setStep('form'); setVerificationId(null); setOtpCode(''); }}>
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

export default SignUpScreen;
