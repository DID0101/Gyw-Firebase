import { useUser } from '@clerk/clerk-expo';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import AppImage from '@/components/AppImage';
import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';

const WelcomeScreen = () => {
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();
  const { t } = useTranslation();

  if (!isLoaded) return null;

  if (isSignedIn) {
    return <Redirect href="/chats" />;
  }

  return (
    <Screen
      className="bg-white"
      viewClassName="px-10 pb-10 w-full items-center justify-end gap-16"
    >
      <AppImage
        source={require('@/assets/images/onboarding_splash_Normal.png')}
        className="w-[85%] h-[55%]"
        contentFit="cover"
      />
      <View className="absolute top-10 right-10">
        <LanguageSwitcher />
      </View>
      <View className="flex items-center gap-4">
        <View className="flex w-full items-center">
          <Text className="text-center text-[28.5px] font-semibold">
            {t('welcome.title1')}
          </Text>
          <Text className="w-[210px] text-center text-[28.5px] font-semibold">
            {t('welcome.title2')}
          </Text>
        </View>
        <Text className="text-base text-gray-500">{t('welcome.terms')}</Text>
      </View>
      <Button onPress={() => router.navigate('/sign-up')}>{t('common.continue')}</Button>
    </Screen>
  );
};

export default WelcomeScreen;
