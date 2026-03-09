import Feather from '@expo/vector-icons/Feather';
import { View } from 'react-native';
import { MessageStatus } from '@/lib/types/chat';

interface MessageStatusIndicatorProps {
  status?: MessageStatus;
  size?: number;
}

const MessageStatusIndicator = ({ status, size = 14 }: MessageStatusIndicatorProps) => {
  const iconColor = 'rgba(255, 255, 255, 0.7)';
  
  if (!status || status === 'pending') {
    return (
      <View>
        <Feather name="clock" size={size} color={iconColor} />
      </View>
    );
  }
  
  if (status === 'sent') {
    return (
      <View>
        <Feather name="check" size={size} color={iconColor} />
      </View>
    );
  }
  
  if (status === 'delivered') {
    // Double check (grey) for delivered
    return (
      <View style={{ flexDirection: 'row', marginLeft: -4 }}>
        <Feather name="check" size={size} color="rgba(255, 255, 255, 0.7)" style={{ marginRight: -4 }} />
        <Feather name="check" size={size} color="rgba(255, 255, 255, 0.7)" />
      </View>
    );
  }
  
  if (status === 'seen') {
    // Double check (blue) for seen
    return (
      <View style={{ flexDirection: 'row', marginLeft: -4 }}>
        <Feather name="check" size={size} color="#4FC3F7" style={{ marginRight: -4 }} />
        <Feather name="check" size={size} color="#4FC3F7" />
      </View>
    );
  }
  
  return null;
};

export default MessageStatusIndicator;

