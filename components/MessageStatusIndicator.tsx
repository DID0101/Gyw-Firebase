import Feather from '@expo/vector-icons/Feather';
import { View } from 'react-native';
import { MessageStatus } from '@/lib/types/chat';

interface MessageStatusIndicatorProps {
  status?: MessageStatus;
  size?: number;
}

const TICK_COLOR = 'rgba(255,255,255,0.65)';
const READ_TICK_COLOR = '#7dd3fc';

const DoubleTick = ({ size, color }: { size: number; color: string }) => (
  <View style={{ width: Math.ceil(size * 1.75), height: size }}>
    <Feather name="check" size={size} color={color} style={{ position: 'absolute', left: 0 }} />
    <Feather name="check" size={size} color={color} style={{ position: 'absolute', left: Math.ceil(size * 0.65) }} />
  </View>
);

const MessageStatusIndicator = ({ status, size = 13 }: MessageStatusIndicatorProps) => {
  if (!status || status === 'pending') {
    return <Feather name="clock" size={size} color={TICK_COLOR} />;
  }
  if (status === 'failed') {
    return <Feather name="alert-circle" size={size} color="#ef4444" />;
  }
  // sent — on server (single tick)
  if (status === 'sent') {
    return <Feather name="check" size={size} color={TICK_COLOR} />;
  }
  // delivered — two ticks (recipient device has the message)
  if (status === 'delivered') {
    return <DoubleTick size={size} color={TICK_COLOR} />;
  }
  // seen — two ticks, read receipt color
  return <DoubleTick size={size} color={READ_TICK_COLOR} />;
};

export default MessageStatusIndicator;
