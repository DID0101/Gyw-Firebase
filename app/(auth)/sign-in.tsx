import { useSignIn } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import useUserForm from '@/hooks/useUserForm';
import { getError } from '@/lib/utils';

const SignInScreen = () => {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

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
          // Check if email or phone verification is needed
          const emailFactor = signInAttempt.supportedFirstFactors?.find(factor => factor.strategy === 'email_code');
          const phoneFactor = signInAttempt.supportedFirstFactors?.find(factor => factor.strategy === 'phone_code');
          
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
        } else if (signInAttempt.status === 'needs_second_factor') {
          // Two-factor authentication is required by Clerk
          // To disable 2FA: Go to Clerk Dashboard → User & Authentication → Multi-factor Authentication → Set to "Optional" or disable
          alert(
            'Two-factor authentication is required.\n\n' +
            'To disable 2FA:\n' +
            '1. Go to Clerk Dashboard\n' +
            '2. User & Authentication → Multi-factor Authentication\n' +
            '3. Set to "Optional" or disable\n\n' +
            'Or complete 2FA verification below.'
          );
          
          // Still allow 2FA verification if user wants to proceed
          const totpFactor = signInAttempt.supportedSecondFactors?.find(factor => factor.strategy === 'totp');
          const phoneFactor = signInAttempt.supportedSecondFactors?.find(factor => factor.strategy === 'phone_code');
          
          if (totpFactor) {
            setVerificationMethod('totp');
            setNeedsSecondFactor(true);
            setPendingVerification(true);
          } else if (phoneFactor) {
            await signIn.prepareSecondFactor({ 
              strategy: 'phone_code',
              phoneNumberId: phoneFactor.phoneNumberId 
            });
            setVerificationMethod('phone');
            setNeedsSecondFactor(true);
            setPendingVerification(true);
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
      if (verificationMethod === 'totp') {
        title = 'Two-Factor Authentication';
        description = 'Enter the code from your authenticator app';
      } else {
        title = 'Verify Phone Number';
        description = 'Enter the code we sent to your phone';
      }
    } else {
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
            Back to sign in
          </Button>
        </View>
        <TextField
          value={code}
          placeholder={verificationMethod === 'totp' ? 'Enter 6-digit code' : 'Enter your verification code'}
          keyboardType="numeric"
          onChangeText={(code) => setCode(code)}
          maxLength={verificationMethod === 'totp' ? 6 : undefined}
        />
        <Button onPress={onVerifyPress}>Verify</Button>
      </Screen>
    );
  }

  return (
    <Screen viewClassName="pt-10 px-4 gap-4" loadingOverlay={loading}>
      <View className="gap-3">
        <Text className="text-center text-3xl font-semibold">Sign in</Text>
        <Text className="text-center text-base text-gray-500">
          Enter your email address and password to sign in.
        </Text>
      </View>
      <TextField
        autoCapitalize="none"
        value={emailAddress}
        placeholder="Enter email"
        onChangeText={onChangeEmailAddress}
      />
      <TextField
        value={password}
        placeholder="Enter password"
        secureTextEntry={true}
        onChangeText={onChangePassword}
      />
      <Button onPress={onSignInPress}>Continue</Button>
      <View className="flex-row gap-[3px]">
        <Text>Don&apos;t have an account?</Text>
        <Link href="/sign-up">
          <Text className="text-blue-600">Sign up</Text>
        </Link>
      </View>
    </Screen>
  );
};

export default SignInScreen;
