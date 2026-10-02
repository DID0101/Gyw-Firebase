import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import CallActionButton from '@/components/calls/incoming/shared/CallActionButton';

const BG = '#0D1B2A';

type OutgoingCallWaitingProps = {
  calleeName: string;
  calleeAvatar?: string;
  callType: 'audio' | 'video';
  message: string;
  onHangUp: () => void;
};

function AnimatedDots() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 450);
    return () => clearInterval(id);
  }, []);

  return <Text style={styles.statusDots}>{dots}</Text>;
}

export default function OutgoingCallWaiting({
  calleeName,
  calleeAvatar,
  callType,
  message,
  onHangUp,
}: OutgoingCallWaitingProps) {
  const callLabel = callType === 'video' ? 'Video call' : 'Voice call';

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Avatar name={calleeName} imageUrl={calleeAvatar} size={120} fontSize={48} />
        <Text allowFontScaling={false} style={styles.name}>
          {calleeName}
        </Text>
        <Text allowFontScaling={false} style={styles.callType}>
          {callLabel}
        </Text>
        <View style={styles.statusRow}>
          <Text allowFontScaling={false} style={styles.status}>
            {message}
          </Text>
          <AnimatedDots />
        </View>
      </View>

      <View style={styles.footer}>
        <CallActionButton
          icon="call"
          label="End call"
          backgroundColor="#E53935"
          size={72}
          onPress={onHangUp}
          style={styles.hangUpBtn}
          iconStyle={{ transform: [{ rotate: '135deg' }] }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'space-between',
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  name: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '600',
    marginTop: 20,
    textAlign: 'center',
  },
  callType: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 14,
    marginTop: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 12,
  },
  status: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '500',
  },
  statusDots: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '500',
    width: 24,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 24,
  },
  hangUpBtn: {
    alignSelf: 'center',
  },
});
