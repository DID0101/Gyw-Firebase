import { memo } from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { Call } from '@/lib/types/call';
import Avatar from './Avatar';

interface CallItemProps {
  call: Call;
  participantName: string;
  isMissed: boolean;
  isRejected: boolean;
  isCompleted: boolean;
  durationText: string;
  dateText: string;
  textColor: string;
  textSecondaryColor: string;
  borderColor: string;
  dotColor: string;
  iconColor: string;
  iconSecondaryColor: string;
  colorScheme: 'light' | 'dark';
  onPress: (call: Call) => void;
  avatarImage?: string;
  missedText?: string;
  rejectedText?: string;
}

const CallItem = memo<CallItemProps>(({
  call,
  participantName,
  isMissed,
  isRejected,
  isCompleted,
  durationText,
  dateText,
  textColor,
  textSecondaryColor,
  borderColor,
  dotColor,
  iconColor,
  iconSecondaryColor,
  colorScheme,
  onPress,
  avatarImage,
  missedText = 'Missed',
  rejectedText = 'Rejected',
}) => {
  return (
    <TouchableOpacity
      onPress={() => onPress(call)}
      className={clsx(
        'flex flex-row items-center gap-3 p-3 border-b',
        borderColor,
        isMissed && (colorScheme === 'dark' ? 'bg-red-900/20' : 'bg-red-50')
      )}
    >
      <Avatar
        name={participantName}
        image={avatarImage}
        size={48}
        fontSize={20}
      />
      <View className="flex-1 min-w-0">
        <View className="flex flex-row items-center gap-2">
          <Text className={clsx(
            'font-semibold text-base flex-1 truncate',
            isMissed ? (colorScheme === 'dark' ? 'text-red-400' : 'text-red-600') : textColor
          )}>
            {participantName}
          </Text>
          <Feather
            name={call.direction === 'incoming' ? 'arrow-down-left' : 'arrow-up-right'}
            size={14}
            color={call.direction === 'incoming' ? '#10b981' : iconSecondaryColor}
          />
          <Feather
            name={call.type === 'video' ? 'video' : 'phone'}
            size={18}
            color={call.type === 'video' ? (colorScheme === 'dark' ? '#60a5fa' : '#2563eb') : iconSecondaryColor}
          />
        </View>
        <View className="flex flex-row items-center gap-2 mt-1">
          {isMissed && (
            <>
              <Text className={clsx('text-sm font-medium', colorScheme === 'dark' ? 'text-red-400' : 'text-red-600')}>
                {missedText}
              </Text>
              <Text className={clsx('text-sm', dotColor)}>•</Text>
            </>
          )}
          {isRejected && (
            <>
              <Text className={clsx('text-sm', textSecondaryColor)}>
                {rejectedText}
              </Text>
              <Text className={clsx('text-sm', dotColor)}>•</Text>
            </>
          )}
          {durationText ? (
            <>
              <Text className={clsx('text-sm', textSecondaryColor)}>
                {durationText}
              </Text>
              <Text className={clsx('text-sm', dotColor)}>•</Text>
            </>
          ) : null}
          <Text className={clsx('text-sm', textSecondaryColor)}>
            {dateText}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}, (prevProps, nextProps) => {
  // Only re-render if call data actually changed
  return (
    prevProps.call.id === nextProps.call.id &&
    prevProps.call.status === nextProps.call.status &&
    prevProps.participantName === nextProps.participantName &&
    prevProps.durationText === nextProps.durationText &&
    prevProps.dateText === nextProps.dateText
  );
});

CallItem.displayName = 'CallItem';

export default CallItem;

