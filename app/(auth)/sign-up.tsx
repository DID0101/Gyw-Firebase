import { signInWithPhoneNumber, PhoneAuthProvider, signInWithCredential, updateProfile, RecaptchaVerifier, type ApplicationVerifier } from 'firebase/auth';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View, Alert, Platform } from 'react-native';

import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import useUserForm from '@/hooks/useUserForm';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { auth, db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreNative';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

// Import native Firebase for native platforms (single app from rnFirebase)
import { getRnAuth, getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

let signInWithPhoneNumberNative: any = null;
let signInWithCredentialNative: any = null;
let PhoneAuthProviderNative: any = null;
let rnFirestoreMod: any = null;
if (Platform.OS !== 'web') {
  try {
    rnFirestoreMod = require('@react-native-firebase/firestore');
    const authModule = require('@react-native-firebase/auth');
    signInWithPhoneNumberNative = authModule.signInWithPhoneNumber;
    signInWithCredentialNative = authModule.signInWithCredential;
    PhoneAuthProviderNative = authModule.PhoneAuthProvider;
    if (__DEV__) console.log('Native Firebase auth/firestore loaded (single app)');
  } catch (e: any) {
    if (__DEV__) console.warn('@react-native-firebase not available:', e?.message || e);
  }
}

type SignUpStep = 'form' | 'otp';

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
  const [step, setStep] = useState<SignUpStep>('form');
  const [phoneNumber, setPhoneNumber] = useState(params.phone || authUser?.phoneNumber || '');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | ApplicationVerifier | null>(null);

  // Store form data for use after OTP (account is created only after OTP success)
  const formDataRef = useRef<{ firstName: string; lastName: string; username: string; phoneNumber: string } | null>(null);

  const {
    firstName,
    lastName,
    username,
    usernameNumber,
    numberError,
    onChangeFirstName,
    onChangeLastName,
    onChangeUsername,
    onChangeNumber,
  } = useUserForm();

  useEffect(() => {
    if (params.completeProfile === '1' && authUser?.phoneNumber) {
      setPhoneNumber(authUser.phoneNumber);
    }
  }, [params.completeProfile, authUser?.phoneNumber]);

  const formatPhoneNumber = (text: string) => {
    let cleaned = text.replace(/[^\d+]/g, '');
    if (cleaned && !cleaned.startsWith('+')) {
      cleaned = '+' + cleaned.replace(/\D/g, '');
    }
    return cleaned;
  };

  const handlePhoneNumberChange = (text: string) => {
    setPhoneNumber(formatPhoneNumber(text));
  };

  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current && Platform.OS === 'web') {
        try {
          (recaptchaVerifierRef.current as RecaptchaVerifier).clear?.();
        } catch (e) {}
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  /** Check if username is available (Firestore). When user is not yet authenticated, Firestore rules block the query - in that case we assume available. */
  const checkUsernameAvailability = async (finalUsername: string): Promise<{ available: boolean; error?: string }> => {
    try {
      let empty: boolean;
      if (Platform.OS !== 'web' && hasRnFirebase && rnFirestoreMod) {
        const db = getRnFirestore();
        const q = rnFirestoreMod.query(
          rnFirestoreMod.collection(db, 'users'),
          rnFirestoreMod.where('username', '==', finalUsername),
          rnFirestoreMod.limit(1)
        );
        const snap = await rnFirestoreMod.getDocs(q);
        empty = snap.empty;
      } else {
        const snap = await getDocs(query(collection(db, 'users'), where('username', '==', finalUsername)));
        empty = snap.empty;
      }
      return { available: empty };
    } catch (e: any) {
      // Permission denied (user not authenticated) or network error - assume available so sign-up can proceed
      if (__DEV__) console.warn('Username check failed (user may not be authenticated yet):', e?.message);
      return { available: true };
    }
  };

  /** STEP 1: Form submit → validate → check username → send OTP */
  const handleFormSubmit = async () => {
    if (numberError) {
      Alert.alert(t('auth.error'), t('profile.usernameHint'));
      return;
    }
    if (!firstName?.trim() || !username?.trim() || !usernameNumber) {
      Alert.alert(t('auth.error'), t('auth.pleaseFillAllFields'));
      return;
    }
    const phone = formatPhoneNumber(phoneNumber);
    if (!phone || phone.length < 10) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterPhone'));
      return;
    }
    if (!phone.startsWith('+')) {
      Alert.alert(t('auth.error'), t('auth.countryCodeRequired'));
      return;
    }

    // Complete profile flow: user already signed in, create doc directly
    if (isCompleteProfile && authUser) {
      setLoading(true);
      try {
        const finalUsername = `${username}_${usernameNumber}`;
        const userPhone = authUser.phoneNumber || phone;
        const userDoc = {
          uid: authUser.uid,
          phoneNumber: userPhone,
          firstName: firstName.trim(),
          lastName: (lastName || '').trim(),
          username: finalUsername,
          photoURL: authUser.photoURL || '',
          bio: '',
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          isOnline: false,
        };
        if (Platform.OS !== 'web' && hasRnFirebase && rnFirestoreMod) {
          const db = getRnFirestore();
          await rnFirestoreMod.setDoc(rnFirestoreMod.doc(db, 'users', authUser.uid), sanitizeForFirestore(userDoc));
      } else {
        await setDoc(doc(db, 'users', authUser.uid), userDoc);
      }
      // Use native user.updateProfile on native; web updateProfile on web
      const displayName = lastName?.trim() ? `${firstName.trim()} ${lastName.trim()}` : firstName.trim();
      if (Platform.OS === 'web') {
        await updateProfile(authUser as any, { displayName });
      } else if (hasRnFirebase) {
        const rnAuth = getRnAuth();
        const nativeUser = rnAuth?.currentUser;
        if (nativeUser?.updateProfile) {
          await nativeUser.updateProfile({ displayName });
        }
      }
        await AsyncStorage.setItem('pendingUsername', finalUsername);
        await AsyncStorage.setItem('pendingPhone', userPhone);
        Alert.alert(t('auth.success'), t('auth.accountCreated'), [{ text: 'OK', onPress: () => router.replace('/(home)/(tabs)/chats') }]);
      } catch (e: any) {
        Alert.alert(t('auth.error'), e?.message || t('auth.signUpFailed'));
      } finally {
        setLoading(false);
      }
      return;
    }

    const finalUsername = `${username}_${usernameNumber}`;
    setLoading(true);
    try {
      const { available } = await checkUsernameAvailability(finalUsername);
      if (!available) {
        Alert.alert(t('auth.error'), t('auth.usernameTaken'));
        setLoading(false);
        return;
      }

      // Store form data for use after OTP success
      formDataRef.current = {
        firstName: firstName.trim(),
        lastName: (lastName || '').trim(),
        username: finalUsername,
        phoneNumber: phone,
      };

      let confirmation: { verificationId: string };
      if (Platform.OS === 'web') {
        if (!recaptchaVerifierRef.current) {
          recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container-signup', {
            size: 'invisible',
            callback: () => {},
            'expired-callback': () => { recaptchaVerifierRef.current = null; },
          });
        }
        confirmation = await signInWithPhoneNumber(auth, phone, recaptchaVerifierRef.current);
      } else {
        if (!hasRnFirebase || !signInWithPhoneNumberNative) {
          throw new Error('Phone authentication requires native Firebase. Use a development build.');
        }
        const confirmationResult = await signInWithPhoneNumberNative(getRnAuth(), phone);
        confirmation = { verificationId: confirmationResult.verificationId || '' };
      }
      setVerificationId(confirmation.verificationId);
      setStep('otp');
      Alert.alert(t('auth.success'), t('auth.otpSent'));
    } catch (error: any) {
      if (__DEV__) console.error('Error sending OTP:', error);
      let msg = error?.message || t('auth.failedToSendOTP');
      if (error?.code === 'auth/invalid-phone-number') msg = 'Invalid phone number format.';
      if (error?.code === 'auth/too-many-requests' || error?.message?.includes('too-many-requests') || error?.message?.includes('blocked all requests')) {
        msg = 'Firebase has temporarily blocked OTP requests from this device due to too many attempts. Wait 24–48 hours, or use a different device/network. For development, add test phone numbers in Firebase Console → Authentication → Phone → Phone numbers for testing.';
      }
      Alert.alert(t('auth.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  /** STEP 2: OTP verified → create account and profile (only after OTP success) */
  const verifyOTP = async () => {
    if (!code || code.length !== 6) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterCode'));
      return;
    }
    if (!verificationId) {
      Alert.alert(t('auth.error'), t('auth.pleaseRequestOTP'));
      return;
    }
    const data = formDataRef.current;
    if (!data) {
      Alert.alert(t('auth.error'), t('auth.sessionExpired'));
      setStep('form');
      return;
    }
    // Ensure form data is present (must come from Sign Up form, not Auth)
    if (!data.firstName?.trim() || !data.username?.trim() || !data.phoneNumber) {
      Alert.alert(t('auth.error'), t('auth.missingProfileData'));
      setStep('form');
      return;
    }

    setLoading(true);
    try {
      let user: { uid: string; phoneNumber?: string; photoURL?: string; updateProfile?: (updates: { displayName?: string }) => Promise<void> };
      if (Platform.OS === 'web') {
        const credential = PhoneAuthProvider.credential(verificationId, code);
        const userCred = await signInWithCredential(auth, credential);
        user = userCred.user;
      } else {
        if (!hasRnFirebase || !PhoneAuthProviderNative || !signInWithCredentialNative) {
          throw new Error('Native Firebase auth is not available');
        }
        const credential = PhoneAuthProviderNative.credential(verificationId, code);
        const userCred = await signInWithCredentialNative(getRnAuth(), credential);
        user = userCred.user;
      }

      // 1) Create full user profile in Firestore FIRST (before auth state propagates / home layout runs)
      const now = new Date().toISOString();
      const userDoc = {
        uid: user.uid,
        phoneNumber: data.phoneNumber,
        firstName: data.firstName.trim(),
        lastName: (data.lastName || '').trim(),
        username: data.username,
        avatar: '',
        photoURL: '',
        bio: '',
        createdAt: now,
        lastSeen: now,
        isOnline: false,
      };
      if (Platform.OS !== 'web' && hasRnFirebase && rnFirestoreMod) {
        const db = getRnFirestore();
        await rnFirestoreMod.setDoc(rnFirestoreMod.doc(db, 'users', user.uid), sanitizeForFirestore(userDoc));
      } else {
        await setDoc(doc(db, 'users', user.uid), userDoc);
      }

      // 2) Then update Auth displayName (for consistency only; profile comes from Firestore)
      const displayName = data.lastName?.trim() ? `${data.firstName} ${data.lastName}` : data.firstName;
      if (Platform.OS === 'web') {
        await updateProfile(user as any, { displayName });
      } else if (user.updateProfile) {
        await user.updateProfile({ displayName });
      }

      await AsyncStorage.setItem('pendingUsername', data.username);
      await AsyncStorage.setItem('pendingPhone', data.phoneNumber);
      Alert.alert(t('auth.success'), t('auth.accountCreated'), [{ text: 'OK', onPress: () => router.replace('/(home)/(tabs)/chats') }]);
    } catch (error: any) {
      if (__DEV__) console.error('Error verifying OTP:', error);
      let msg = error?.message || t('auth.invalidCode');
      if (error?.code === 'auth/invalid-verification-code') msg = 'Invalid verification code.';
      if (error?.code === 'auth/code-expired' || error?.code === 'auth/session-expired') {
        msg = 'Code expired. Please request a new code.';
        setVerificationId(null);
        setCode('');
        setStep('form');
      }
      Alert.alert(t('auth.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'tk', name: 'Türkmen' },
    { code: 'ru', name: 'Русский' },
  ];
  const currentLangName = languages.find((l) => l.code === i18n.language)?.name || 'English';

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      <View className="absolute top-10 right-4 z-10">
        <Pressable
          onPress={() => setShowLanguageModal(true)}
          className={clsx('flex-row items-center gap-2 px-4 py-2.5 rounded-full', useThemeClassName('bg-gray-100', 'bg-gray-800'))}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View className={clsx('w-7 h-7 rounded-full items-center justify-center', useThemeClassName('bg-white', 'bg-gray-700'))}>
            <Feather name="globe" size={14} color="#337E84" />
          </View>
          <Text className={clsx('text-sm font-semibold', textColor)}>{currentLangName}</Text>
        </Pressable>
        <LanguageSwitcher initialVisible={showLanguageModal} onModalVisibilityChange={setShowLanguageModal} />
      </View>

      <View className="gap-3">
        <Text className={clsx('text-center text-3xl font-semibold', textColor)}>{t('auth.signUp')}</Text>
        <Text className={clsx('text-center text-base', textSecondaryColor)}>
          {step === 'form' ? t('auth.createAccount') : t('auth.enterCode')}
        </Text>
      </View>

      {step === 'form' && (
        <>
          <TextField value={firstName} placeholder={t('auth.firstName')} onChangeText={onChangeFirstName} />
          <TextField value={lastName} placeholder={t('auth.lastName')} onChangeText={onChangeLastName} />
          <View className="relative">
            <TextField autoCapitalize="none" value={username} placeholder={t('auth.username')} onChangeText={onChangeUsername} className="pr-12" />
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
            <Text className={clsx('pl-2 pt-2 text-xs', numberError ? 'text-red-500' : hintTextColor)}>{numberError || t('profile.usernameHint')}</Text>
          </View>
          <TextField
            value={phoneNumber}
            placeholder={t('auth.phoneNumber') + ' (e.g., +1234567890)'}
            onChangeText={handlePhoneNumberChange}
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={!isCompleteProfile}
          />
          <Button onPress={handleFormSubmit}>{t('common.continue')}</Button>
        </>
      )}

      {step === 'otp' && (
        <>
          <Text className={clsx('text-sm text-center', textSecondaryColor)}>{t('auth.enterCodeSentTo')} {formDataRef.current?.phoneNumber || phoneNumber}</Text>
          <TextField value={code} placeholder={t('auth.enterCode')} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoFocus />
          <Button onPress={verifyOTP}>{t('auth.verify')}</Button>
          <Pressable
            onPress={() => {
              setStep('form');
              setVerificationId(null);
              setCode('');
            }}
          >
            <Text className="text-center text-[#337E84]">{t('auth.wrongPhoneNumber')}</Text>
          </Pressable>
        </>
      )}

      {!isCompleteProfile && (
        <View className="flex-row gap-[3px]">
          <Text>{t('auth.alreadyHaveAccount')}</Text>
          <Link href="/sign-in">
            <Text style={{ color: '#337E84' }}>{t('auth.signIn')}</Text>
          </Link>
        </View>
      )}

      {Platform.OS === 'web' && (
        <View nativeID="recaptcha-container-signup" style={{ display: 'none', position: 'absolute', width: 0, height: 0 }} />
      )}
    </Screen>
  );
};

export default SignUpScreen;
