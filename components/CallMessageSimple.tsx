import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MessageSimple, useMessageContext } from 'stream-chat-expo';

import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';

const CallMessageSimple = (props: any) => {
  const { message } = useMessageContext();
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const textColor = useThemeClassName('text-gray-600', 'text-gray-400');
  const iconColor = colorScheme === 'dark' ? '#9ca3af' : '#6b7280';

  // Check if this is a call message
  if (message?.type === 'system' && (message as any)?.customType === 'call_ended') {
    // Get call info from channel custom data
    const channel = (message as any)?.channel_state?.channel;
    const callInfo = (channel?.data as any)?.lastCall || null;
    const isVideoCall = callInfo?.type === 'video';
    const duration = callInfo?.duration || 0;

    const formatDuration = (seconds: number) => {
      if (seconds < 60) return `${seconds}s`;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    return (
      <View className="flex flex-row items-center justify-center gap-2 py-2 px-4">
        <Feather
          name={isVideoCall ? 'video' : 'phone'}
          size={16}
          color={iconColor}
        />
        <Text className={clsx('text-sm', textColor)}>
          {isVideoCall ? t('calls.videoCall') : t('calls.audioCall')}
          {duration > 0 && ` • ${formatDuration(duration)}`}
        </Text>
      </View>
    );
  }

  // Use default MessageSimple for all messages
  // Stream Chat handles image display natively
  return <MessageSimple {...props} />;
};

export default CallMessageSimple;

