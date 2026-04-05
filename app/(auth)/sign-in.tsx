import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { Link, useRouter } from 'expo-router';
import { PhoneAuthProvider, RecaptchaVerifier, signInWithCredential, signInWithPhoneNumber, type ApplicationVerifier } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import { auth } from '@/lib/firebase';
import { useThemeClassName } from '@/lib/themeUtils';

// Import native Firebase auth for native platforms (single app from rnFirebase)
import { getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';

let signInWithPhoneNumberNative: any = null;
let signInWithCredentialNative: any = null;
let PhoneAuthProviderNative: any = null;
if (Platform.OS !== 'web') {
  try {
    const authModule = require('@react-native-firebase/auth');
    signInWithPhoneNumberNative = authModule.signInWithPhoneNumber;
    signInWithCredentialNative = authModule.signInWithCredential;
    PhoneAuthProviderNative = authModule.PhoneAuthProvider;
    if (__DEV__) console.log('Native Firebase auth loaded (modular, single app)');
  } catch (e: any) {
    if (__DEV__) {
      console.warn('@react-native-firebase/auth not available:', e?.message || e);
      console.warn('Make sure to rebuild: npx expo prebuild --clean && npx expo run:android');
    }
  }
}

const SignInScreen = () => {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | ApplicationVerifier | null>(null);

  // Format phone number with country code
  const formatPhoneNumber = (text: string) => {
    // Remove any non-digit characters except +
    let cleaned = text.replace(/[^\d+]/g, '');
    // Ensure it starts with + if it doesn't already
    if (cleaned && !cleaned.startsWith('+')) {
      cleaned = '+' + cleaned.replace(/\D/g, '');
    }
    return cleaned;
  };

  const handlePhoneNumberChange = (text: string) => {
    setPhoneNumber(formatPhoneNumber(text));
  };

  // Cleanup reCAPTCHA verifier on unmount
  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current && Platform.OS === 'web') {
        try {
          const verifier = recaptchaVerifierRef.current as RecaptchaVerifier;
          if (verifier && typeof verifier.clear === 'function') {
            verifier.clear();
          }
        } catch (error) {
          // Ignore cleanup errors
        }
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  const sendOTP = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterPhone'));
      return;
    }

    // Ensure phone number has country code
    if (!phoneNumber.startsWith('+')) {
      Alert.alert(t('auth.error'), t('auth.countryCodeRequired'));
      return;
    }

    setLoading(true);
    try {
      let confirmation;
      
      if (Platform.OS === 'web') {
        // For web, we need RecaptchaVerifier
        if (!recaptchaVerifierRef.current) {
          // Create invisible reCAPTCHA verifier
          recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
            size: 'invisible',
            callback: () => {
              if (__DEV__) console.log('reCAPTCHA solved');
            },
            'expired-callback': () => {
              if (__DEV__) console.error('reCAPTCHA expired');
              recaptchaVerifierRef.current = null;
            },
          });
        }
        confirmation = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifierRef.current);
      } else {
        // For native (iOS/Android), use rnFirebase (same app as Firestore/Functions)
        if (!hasRnFirebase || !signInWithPhoneNumberNative) {
          // Native modules are not available
          throw new Error(
            'Phone authentication requires native Firebase modules.\n\n' +
            '⚠️ IMPORTANT: You must use a DEVELOPMENT BUILD, not Expo Go!\n\n' +
            'Expo Go does not support native modules like @react-native-firebase/auth.\n\n' +
            'To fix this:\n\n' +
            '1. Make sure you built the app: npx expo run:android\n' +
            '2. Install the APK on your device (not Expo Go)\n' +
            '3. Open the development build app (not Expo Go)\n' +
            '4. Connect to Metro bundler\n\n' +
            'The APK is located at:\n' +
            'android/app/build/outputs/apk/debug/app-debug.apk\n\n' +
            'If you see this error in the development build, the native modules may not be properly linked. ' +
            'Try: npx expo prebuild --clean && npx expo run:android'
          );
        }
        
        // Native Firebase auth doesn't need RecaptchaVerifier
        const rnAuth = getRnAuth();
        const confirmationResult = await signInWithPhoneNumberNative(rnAuth, phoneNumber);
        confirmation = {
          verificationId: confirmationResult.verificationId || '',
        } as any;
      }
      
      setVerificationId(confirmation.verificationId);
      Alert.alert(t('auth.success'), t('auth.otpSent'));
    } catch (error: any) {
      if (__DEV__) console.error('Error sending OTP:', error);
      let errorMessage = error.message || t('auth.failedToSendOTP');
      
      if (error.code === 'auth/argument-error') {
        errorMessage = 'Please ensure phone number includes country code (e.g., +1234567890)';
      } else if (error.code === 'auth/invalid-phone-number') {
        errorMessage = 'Invalid phone number format. Please use format: +1234567890';
      } else if (
        error.code === 'auth/missing-client-identifier' ||
        error.message?.includes('missing-client-identifier') ||
        error.message?.includes('Play Integrity')
      ) {
        errorMessage =
          '🔐 App verification failed for this phone number.\n\n' +
          'Firebase could not verify your device with Google Play Integrity / reCAPTCHA, so real phone numbers are temporarily blocked.\n\n' +
          '✅ What you can do:\n' +
          '• Use a Firebase test phone number (no SMS, always works).\n' +
          '• Or try again later / on a different device or network.\n\n' +
          'This is a Google verification restriction, not an app configuration issue.';
      } else if (error.code === 'auth/too-many-requests' || error.message?.includes('too-many-requests') || error.message?.includes('blocked all requests')) {
        errorMessage = '⚠️ Rate Limit: Firebase has blocked requests from this device/IP.\n\n' +
          'This can persist for 24-48 hours after too many attempts.\n\n' +
          '📱 Solutions:\n' +
          '• Wait 24-48 hours for rate limit to expire\n' +
          '• Use a different device/network\n' +
          '• Contact Firebase support to lift the block';
      }
      
      Alert.alert(t('auth.error'), errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    if (!code || code.length !== 6) {
      Alert.alert(t('auth.error'), t('auth.pleaseEnterCode'));
      return;
    }

    if (!verificationId) {
      Alert.alert(t('auth.error'), t('auth.pleaseRequestOTP'));
      return;
    }

    setLoading(true);
    try {
      let signedInUser: { uid: string; phoneNumber?: string } | null = null;
      if (Platform.OS === 'web') {
        const credential = PhoneAuthProvider.credential(verificationId, code);
        const userCred = await signInWithCredential(auth, credential);
        signedInUser = { uid: userCred.user.uid, phoneNumber: userCred.user.phoneNumber || phoneNumber };
      } else {
        if (!hasRnFirebase || !PhoneAuthProviderNative || !signInWithCredentialNative) {
          throw new Error('Native Firebase auth is not available');
        }
        const rnAuth = getRnAuth();
        const credential = PhoneAuthProviderNative.credential(verificationId, code);
        const userCred = await signInWithCredentialNative(rnAuth, credential);
        signedInUser = { uid: userCred.user.uid, phoneNumber: userCred.user.phoneNumber || phoneNumber };
      }

      // Check if user profile exists in Firestore
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('@/lib/firebase');
      let userDocExists = false;
      let userDocComplete = false;
      try {
        if (Platform.OS !== 'web') {
          const { getRnFirestore } = require('@/lib/rnFirebase');
          const rnFs = require('@react-native-firebase/firestore');
          const db = getRnFirestore();
          const snap = await rnFs.getDoc(rnFs.doc(db, 'users', signedInUser.uid));
          if (snap.exists) {
            userDocExists = true;
            const d = snap.data();
            userDocComplete = !!(d?.firstName && d?.username);
          }
        } else {
          const snap = await getDoc(doc(db, 'users', signedInUser.uid));
          if (snap.exists()) {
            userDocExists = true;
            const d = snap.data();
            userDocComplete = !!(d?.firstName && d?.username);
          }
        }
      } catch (_) {}

      if (userDocExists && userDocComplete) {
        router.replace('/(home)/(tabs)/chats');
      } else {
        // New user: redirect to sign-up to complete profile
        router.replace({ pathname: '/sign-up', params: { completeProfile: '1', phone: phoneNumber } });
      }
    } catch (error: any) {
      if (__DEV__) console.error('Error verifying OTP:', error);
      let errorMessage = error.message || t('auth.invalidCode');
      
      // Handle specific error codes
      if (error.code === 'auth/session-expired' || error.message?.includes('expired')) {
        errorMessage = 'The verification code has expired. Please request a new code.';
        // Reset verification state so user can request a new code
        setVerificationId(null);
        setCode('');
      } else if (error.code === 'auth/invalid-verification-code') {
        errorMessage = 'Invalid verification code. Please check and try again.';
      } else if (error.code === 'auth/code-expired') {
        errorMessage = 'The verification code has expired. Please request a new code.';
        setVerificationId(null);
        setCode('');
      }
      
      Alert.alert(t('auth.error'), errorMessage);
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
  const currentLangName = languages.find((lang) => lang.code === i18n.language)?.name || 'English';

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      <View className="absolute top-8 right-4 z-10">
        <Pressable
          onPress={() => setShowLanguageModal(true)}
          className={clsx(
            'flex-row items-center gap-2.5 px-3.5 py-2 rounded-full',
            useThemeClassName('bg-white/90', 'bg-gray-800/90'),
            'shadow-sm'
          )}
          style={({ pressed }) => ({
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Feather name="globe" size={16} color="#337E84" />
          <Text className={clsx('text-sm font-medium', textColor)}>
            {currentLangName}
          </Text>
        </Pressable>
        <LanguageSwitcher 
          initialVisible={showLanguageModal}
          onModalVisibilityChange={setShowLanguageModal}
        />
      </View>
      <View className="gap-3">
        <Text className={clsx('text-center text-3xl font-semibold', textColor)}>{t('auth.signIn')}</Text>
        <Text className={clsx('text-center text-base', textSecondaryColor)}>
          {verificationId 
            ? t('auth.enterCode') 
            : t('auth.enterPhoneNumber')}
        </Text>
      </View>
      
      {!verificationId ? (
        <>
          <TextField
            value={phoneNumber}
            placeholder={t('auth.phoneNumber') + ' (e.g., +1234567890)'}
            onChangeText={handlePhoneNumberChange}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Button onPress={sendOTP}>{t('auth.sendOTP')}</Button>
        </>
      ) : (
        <>
          <Text className={clsx('text-sm text-center', textSecondaryColor)}>
            {t('auth.enterCodeSentTo')} {phoneNumber}
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
          <Pressable onPress={() => {
            setVerificationId(null);
            setCode('');
          }}>
            <Text className="text-center text-[#337E84]">
              {t('auth.wrongPhoneNumber')}
            </Text>
          </Pressable>
        </>
      )}
      
      <View className="flex-row gap-[3px]">
        <Text>{t('auth.dontHaveAccount')}</Text>
        <Link href="/sign-up">
          <Text style={{ color: '#337E84' }}>{t('auth.signUp')}</Text>
        </Link>
      </View>
      {/* Hidden containers for reCAPTCHA */}
      {Platform.OS === 'web' && (
        <View 
          nativeID="recaptcha-container" 
          style={{ display: 'none', position: 'absolute', width: 0, height: 0 }} 
        />
      )}
      {Platform.OS !== 'web' && (
        <View 
          nativeID="native-verifier" 
          style={{ display: 'none', position: 'absolute', width: 0, height: 0 }} 
        />
      )}
    </Screen>
  );
};

export default SignInScreen;
