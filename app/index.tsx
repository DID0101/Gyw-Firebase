import clsx from 'clsx';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import AppImage from '@/components/AppImage';
import Button from '@/components/Button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Screen from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeClassName } from '@/lib/themeUtils';

const WelcomeScreen = () => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');

  useEffect(() => {
    if (loading) return;
    if (!user) return; // Not signed in — show welcome screen below

    router.replace('/(home)/(tabs)/chats' as never);
  }, [user, loading, router]);

  // While auth is loading or user is signed in (and we're navigating), render nothing.
  if (loading || user) return null;

  return (
    <Screen viewClassName="px-10 pb-10 w-full items-center justify-end gap-16">
      <AppImage
        source={require('@/assets/images/gyw_fox_logo.png')}
        className="w-[95%] h-[65%]"
        contentFit="contain"
      />
      <View className="absolute top-10 right-10">
        <LanguageSwitcher />
      </View>
      <View className="flex items-center gap-4">
        <View className="flex w-full items-center">
          <Text className={clsx('text-center text-[28.5px] font-semibold', textColor)}>
            {t('welcome.title1')}
          </Text>
          <Text className={clsx('w-[210px] text-center text-[28.5px] font-semibold', textColor)}>
            {t('welcome.title2')}
          </Text>
        </View>
        <Text className={clsx('text-base', textSecondaryColor)}>{t('welcome.terms')}</Text>
      </View>
      <Button onPress={() => router.navigate('/sign-up')}>{t('common.continue')}</Button>
    </Screen>
  );
};

export default WelcomeScreen;
