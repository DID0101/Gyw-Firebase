import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import Button from '@/components/Button';

const ModalLayout = () => {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerBackground: () => null,
        headerTintColor: 'black',
        headerBackButtonDisplayMode: 'minimal',
        headerTitleAlign: 'center',
      }}
    >
      <Stack.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="right-4"
            >
              <Feather name="chevron-left" size={32} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="new-message"
        options={{
          title: t('chats.newMessage'),
          headerLeft: () => (
            <Button variant="text" onPress={() => router.dismiss()}>
              {t('common.cancel')}
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="new-group"
        options={{
          title: t('groups.selectMembers'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="right-4"
            >
              <Feather name="chevron-left" size={32} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="find-by-username"
        options={{
          title: t('chats.findByUsername'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="right-4"
            >
              <Feather name="chevron-left" size={32} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="find-by-contact"
        options={{
          title: t('chats.findByContactTitle'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="right-4"
            >
              <Feather name="chevron-left" size={32} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="story-viewer"
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
        }}
      />
    </Stack>
  );
};

export default ModalLayout;
