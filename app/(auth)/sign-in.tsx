import { useSignIn } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import useUserForm from '@/hooks/useUserForm';
import { getError } from '@/lib/utils';

const SignInScreen = () => {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const { t } = useTranslation();

  const { emailAddress, password, onChangeEmailAddress, onChangePassword } =
    useUserForm();
  const [loading, setLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [needsSecondFactor, setNeedsSecondFactor] = useState(false);
  const [code, setCode] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<'email' | 'phone' | 'totp' | null>(null);

  const onSignInPress = async () => {
    if (!isLoaded) return;
    setLoading(true);
    try {
      const signInAttempt = await signIn.create({
        identifier: emailAddress.toLowerCase().trim(),
        password,
      });

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId });
        router.replace('/chats');
      } else {
        // Handle incomplete states - check what verification is needed
        if (signInAttempt.status === 'needs_first_factor') {
          // Clerk is requiring verification even though user signed up
          // This usually happens if Clerk settings require verification on sign-in
          // Check if email or phone verification is needed
          const emailFactor = signInAttempt.supportedFirstFactors?.find(factor => factor.strategy === 'email_code');
          const phoneFactor = signInAttempt.supportedFirstFactors?.find(factor => factor.strategy === 'phone_code');
          
          // Check if user's email/phone is already verified
          const unverifiedEmailAddresses = signInAttempt.unverifiedFields?.emailAddress || [];
          const unverifiedPhoneNumbers = signInAttempt.unverifiedFields?.phoneNumber || [];
          
          // If email/phone is already verified, Clerk might still require verification due to settings
          // This happens when "Require email verification on sign-in" is enabled in Clerk Dashboard
          if (unverifiedEmailAddresses.length === 0 && unverifiedPhoneNumbers.length === 0) {
            // Email and phone are verified, but Clerk still requires verification
            // This is a Clerk security setting - user needs to complete verification
            // To disable: Clerk Dashboard → User & Authentication → Email, Phone, Username → 
            //            Disable "Require email verification on sign-in"
            if (emailFactor) {
              await signIn.prepareFirstFactor({ 
                strategy: 'email_code',
                emailAddressId: emailFactor.emailAddressId 
              });
              setVerificationMethod('email');
              setPendingVerification(true);
            } else if (phoneFactor) {
              await signIn.prepareFirstFactor({ 
                strategy: 'phone_code',
                phoneNumberId: phoneFactor.phoneNumberId 
              });
              setVerificationMethod('phone');
              setPendingVerification(true);
            } else {
              alert('Verification required. Please check your email or phone for a code.');
            }
          } else {
            // Email/phone needs verification
            if (emailFactor) {
              await signIn.prepareFirstFactor({ 
                strategy: 'email_code',
                emailAddressId: emailFactor.emailAddressId 
              });
              setVerificationMethod('email');
              setPendingVerification(true);
            } else if (phoneFactor) {
              await signIn.prepareFirstFactor({ 
                strategy: 'phone_code',
                phoneNumberId: phoneFactor.phoneNumberId 
              });
              setVerificationMethod('phone');
              setPendingVerification(true);
            } else {
              alert('Additional verification required. Please check your email or phone.');
            }
          }
        } else if (signInAttempt.status === 'needs_second_factor') {
          // Two-factor authentication is required
          const totpFactor = signInAttempt.supportedSecondFactors?.find(factor => factor.strategy === 'totp');
          const phoneFactor = signInAttempt.supportedSecondFactors?.find(factor => factor.strategy === 'phone_code');
          
          if (totpFactor) {
            // TOTP (authenticator app) - no need to prepare, just show input
            setVerificationMethod('totp');
            setNeedsSecondFactor(true);
            setPendingVerification(true);
          } else if (phoneFactor) {
            // Phone code - prepare and send code
            await signIn.prepareSecondFactor({ 
              strategy: 'phone_code',
              phoneNumberId: phoneFactor.phoneNumberId 
            });
            setVerificationMethod('phone');
            setNeedsSecondFactor(true);
            setPendingVerification(true);
          } else {
            alert('Two-factor authentication is required. Please set up 2FA in your account settings.');
          }
        } else {
          console.log('Sign-in status:', signInAttempt.status);
          alert('Sign-in incomplete. Status: ' + signInAttempt.status);
        }
      }
    } catch (err) {
      getError(err);
    } finally {
      setLoading(false);
    }
  };

  const onVerifyPress = async () => {
    if (!isLoaded || !verificationMethod) return;
    setLoading(true);
    try {
      let signInAttempt;
      
      if (needsSecondFactor) {
        // Handle second factor verification
        if (verificationMethod === 'totp') {
          signInAttempt = await signIn.attemptSecondFactor({
            strategy: 'totp',
            code,
          });
        } else {
          signInAttempt = await signIn.attemptSecondFactor({
            strategy: 'phone_code',
            code,
          });
        }
      } else {
        // Handle first factor verification
        if (verificationMethod === 'email') {
          signInAttempt = await signIn.attemptFirstFactor({
            strategy: 'email_code',
            code,
          });
        } else {
          signInAttempt = await signIn.attemptFirstFactor({
            strategy: 'phone_code',
            code,
          });
        }
      }

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId });
        router.replace('/chats');
      } else if (signInAttempt.status === 'needs_second_factor') {
        // After first factor, now needs second factor
        const totpFactor = signInAttempt.supportedSecondFactors?.find(factor => factor.strategy === 'totp');
        const phoneFactor = signInAttempt.supportedSecondFactors?.find(factor => factor.strategy === 'phone_code');
        
        if (totpFactor) {
          setVerificationMethod('totp');
          setNeedsSecondFactor(true);
          setCode(''); // Clear code for second factor
        } else if (phoneFactor) {
          await signIn.prepareSecondFactor({ 
            strategy: 'phone_code',
            phoneNumberId: phoneFactor.phoneNumberId 
          });
          setVerificationMethod('phone');
          setNeedsSecondFactor(true);
          setCode(''); // Clear code for second factor
        }
      } else {
        alert('Verification incomplete. Please try again.');
      }
    } catch (err) {
      getError(err);
    } finally {
      setLoading(false);
    }
  };

  if (pendingVerification) {
    let title = '';
    let description = '';
    
    if (needsSecondFactor) {
      // Two-factor authentication
      if (verificationMethod === 'totp') {
        title = 'Two-Factor Authentication';
        description = 'Enter the 6-digit code from your authenticator app';
      } else {
        title = 'Two-Factor Authentication';
        description = 'Enter the code we sent to your phone';
      }
    } else {
      // First factor verification (email/phone verification)
      title = verificationMethod === 'email' ? 'Verify Email Address' : 'Verify Phone Number';
      description = verificationMethod === 'email' 
        ? `Enter the code we sent to ${emailAddress.toLowerCase()}`
        : 'Enter the code we sent to your phone';
    }
    
    return (
      <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
        <View className="gap-3">
          <Text className="text-center text-3xl font-semibold">
            {title}
          </Text>
          <Text className="text-center text-base text-gray-500">
            {description}
          </Text>
          <Button
            variant="text"
            className="text-base text-blue-600"
            onPress={() => {
              setPendingVerification(false);
              setNeedsSecondFactor(false);
              setCode('');
              setVerificationMethod(null);
            }}
          >
            {t('common.back')} {t('auth.signIn').toLowerCase()}
          </Button>
        </View>
        <TextField
          value={code}
          placeholder={verificationMethod === 'totp' ? t('auth.enterCode') + ' (6 digits)' : t('auth.enterCode')}
          keyboardType="numeric"
          onChangeText={(code) => setCode(code)}
          maxLength={verificationMethod === 'totp' ? 6 : undefined}
        />
        <Button onPress={onVerifyPress}>{t('common.verify')}</Button>
      </Screen>
    );
  }

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      <View className="gap-3">
        <Text className="text-center text-3xl font-semibold">{t('auth.signIn')}</Text>
        <Text className="text-center text-base text-gray-500">
          {t('auth.enterEmail')} {t('common.and')} {t('auth.password')} {t('auth.toSignIn')}
        </Text>
      </View>
      <TextField
        autoCapitalize="none"
        value={emailAddress}
        placeholder={t('auth.enterEmail')}
        onChangeText={onChangeEmailAddress}
      />
      <TextField
        value={password}
        placeholder={t('auth.enterPassword')}
        secureTextEntry={true}
        onChangeText={onChangePassword}
      />
      <Button onPress={onSignInPress}>{t('common.continue')}</Button>
      <View className="flex-row gap-[3px]">
        <Text>{t('auth.dontHaveAccount')}</Text>
        <Link href="/sign-up">
          <Text className="text-blue-600">{t('auth.signUp')}</Text>
        </Link>
      </View>
    </Screen>
  );
};

export default SignInScreen;
