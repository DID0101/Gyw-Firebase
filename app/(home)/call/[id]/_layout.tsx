import { Stack, useGlobalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import ScreenLoading from '@/components/ScreenLoading';
import { useAuth } from '@/contexts/AuthContext';

const CallLayout = () => {
  const { id } = useGlobalSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    // TODO: Implement WebRTC call setup
    // For now, just show the call screen
  }, [id, user]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
};

export default CallLayout;
