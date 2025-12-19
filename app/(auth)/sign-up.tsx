import { useSignUp } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import useUserForm from '@/hooks/useUserForm';
import { getError } from '@/lib/utils';

type SignUpMethod = 'email' | 'phone';

const SignUpScreen = () => {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();
  const { t } = useTranslation();
  const {
    firstName,
    lastName,
    username,
    usernameNumber,
    numberError,
    emailAddress,
    phoneNumber,
    password,
    onChangeFirstName,
    onChangeLastName,
    onChangeUsername,
    onChangeNumber,
    onChangeEmailAddress,
    onChangePhoneNumber,
    onChangePassword,
  } = useUserForm();
  const [signUpMethod, setSignUpMethod] = useState<SignUpMethod>('email');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState<'email' | 'phone'>('email');

  const onSignUpPress = async () => {
    if (!isLoaded || numberError) return;
    
    // Validate required fields based on sign-up method
    if (signUpMethod === 'email' && !emailAddress) {
      alert('Please enter your email address');
      return;
    }
    if (signUpMethod === 'phone' && !phoneNumber) {
      alert('Please enter your phone number');
      return;
    }
    
    setLoading(true);
    try {
      const signUpData: any = {
        firstName,
        lastName,
        password,
      };

      if (signUpMethod === 'email') {
        signUpData.emailAddress = emailAddress.toLowerCase();
      } else {
        signUpData.phoneNumber = phoneNumber;
      }

      await signUp.create(signUpData);
      
      if (signUpMethod === 'email') {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setVerificationMethod('email');
      } else {
        await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
        setVerificationMethod('phone');
      }
      
      setPendingVerification(true);
    } catch (err: any) {
      getError(err);
    } finally {
      setLoading(false);
    }
  };

  const onVerifyPress = async () => {
    if (!isLoaded) return;
    setLoading(true);
    try {
      let signUpAttempt;
      
      if (verificationMethod === 'email') {
        signUpAttempt = await signUp.attemptEmailAddressVerification({
          code,
        });
      } else {
        signUpAttempt = await signUp.attemptPhoneNumberVerification({
          code,
        });
      }

      if (signUpAttempt.status === 'complete') {
        // Store username and contact info for Stream Chat setup
        const finalUsername = `${username}_${usernameNumber}`;
        await AsyncStorage.setItem('pendingUsername', finalUsername);
        
        // Store phone or email for Stream Chat
        if (verificationMethod === 'email') {
          await AsyncStorage.setItem('pendingEmail', emailAddress.toLowerCase());
        } else {
          await AsyncStorage.setItem('pendingPhone', phoneNumber);
        }
        
        await setActive({ session: signUpAttempt.createdSessionId });
        router.replace('/chats');
      } else {
        console.error(JSON.stringify(signUpAttempt, null, 2));
      }
    } catch (err) {
      getError(err);
    } finally {
      setLoading(false);
    }
  };

  if (pendingVerification) {
    const verificationTarget = verificationMethod === 'email' 
      ? emailAddress.toLowerCase() 
      : phoneNumber;
    
    return (
      <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
        <View className="absolute top-10 right-10">
          <LanguageSwitcher />
        </View>
        <View className="gap-3">
          <Text className="text-center text-3xl font-semibold">
            {verificationMethod === 'email' ? t('auth.verifyEmail') : t('auth.verifyPhone')}
          </Text>
          <Text className="text-center text-base text-gray-500">
            {t('auth.enterCode')} {verificationTarget}
          </Text>
          <Button
            variant="text"
            className="text-base text-blue-600"
            onPress={() => setPendingVerification(false)}
          >
            {verificationMethod === 'email' ? t('auth.wrongEmail') : t('auth.wrongPhone')}
          </Button>
        </View>
        <TextField
          value={code}
          placeholder={t('auth.enterCode')}
          keyboardType="numeric"
          onChangeText={(code) => setCode(code)}
        />
        <Button onPress={onVerifyPress}>{t('common.verify')}</Button>
      </Screen>
    );
  }

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      <View className="absolute top-10 right-10">
        <LanguageSwitcher />
      </View>
      <View className="gap-3">
        <Text className="text-center text-3xl font-semibold">{t('auth.signUp')}</Text>
        <Text className="text-center text-base text-gray-500">
          {t('auth.createAccount')}
        </Text>
      </View>
      
      {/* Sign-up method selector */}
      <View className="flex-row gap-2 mb-2 bg-gray-100 rounded-[13px] p-1">
        <TouchableOpacity
          className={clsx(
            'flex-1 rounded-[10px] py-3 items-center justify-center',
            signUpMethod === 'email' ? 'bg-blue-600' : 'bg-transparent'
          )}
          onPress={() => setSignUpMethod('email')}
        >
          <Text className={clsx(
            'text-base font-medium',
            signUpMethod === 'email' ? 'text-white' : 'text-gray-700'
          )}>
            {t('auth.email')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={clsx(
            'flex-1 rounded-[10px] py-3 items-center justify-center',
            signUpMethod === 'phone' ? 'bg-blue-600' : 'bg-transparent'
          )}
          onPress={() => setSignUpMethod('phone')}
        >
          <Text className={clsx(
            'text-base font-medium',
            signUpMethod === 'phone' ? 'text-white' : 'text-gray-700'
          )}>
            {t('auth.phone')}
          </Text>
        </TouchableOpacity>
      </View>

      <View className="gap-3">
        <TextField
          value={firstName}
          placeholder={t('auth.firstName')}
          onChangeText={onChangeFirstName}
        />
        <TextField
          value={lastName}
          placeholder={t('auth.lastName')}
          onChangeText={onChangeLastName}
        />
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
          <Text
            className={clsx(
              'pl-2 pt-2 text-xs',
              numberError ? 'text-red-500' : 'text-gray-500'
            )}
          >
            {numberError ||
              t('profile.usernameHint')}
          </Text>
        </View>
        {signUpMethod === 'email' ? (
          <TextField
            autoCapitalize="none"
            value={emailAddress}
            placeholder={t('auth.emailAddress')}
            onChangeText={onChangeEmailAddress}
            keyboardType="email-address"
          />
        ) : (
          <TextField
            value={phoneNumber}
            placeholder={t('auth.phoneNumber') + ' (e.g., +1234567890)'}
            onChangeText={onChangePhoneNumber}
            keyboardType="phone-pad"
          />
        )}
        <TextField
          value={password}
          placeholder={t('auth.password')}
          secureTextEntry={true}
          onChangeText={onChangePassword}
        />
      </View>
      <Button onPress={onSignUpPress}>{t('common.continue')}</Button>
      <View className="flex-row gap-[3px]">
        <Text>{t('auth.alreadyHaveAccount')}</Text>
        <Link href="/sign-in">
          <Text className="text-blue-600">{t('auth.signIn')}</Text>
        </Link>
      </View>
    </Screen>
  );
};

export default SignUpScreen;
