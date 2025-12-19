import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';

import Button from '@/components/Button';

const ModalLayout = () => {
  const router = useRouter();
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
          title: 'Profile',
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
          title: 'New Message',
          headerLeft: () => (
            <Button variant="text" onPress={() => router.dismiss()}>
              Cancel
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="new-group"
        options={{
          title: 'Select Members',
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
          title: 'Find by Username',
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
          title: 'Find by Contact',
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
    </Stack>
  );
};

export default ModalLayout;
