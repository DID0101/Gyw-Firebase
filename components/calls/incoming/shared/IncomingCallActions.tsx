import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ACTION_BUTTON_LARGE,
  ACTION_BUTTON_SMALL,
  CALL_COLORS,
} from '@/constants/CallTheme';

import CallActionButton from './CallActionButton';

export type IncomingCallActionsProps = {
  onAccept: () => void;
  onDecline: () => void;
  onMessage?: () => void;
  onRemindLater?: () => void;
  callType: 'audio' | 'video';
};

export const IncomingCallActions = memo(function IncomingCallActions({
  onAccept,
  onDecline,
  onMessage,
  onRemindLater,
  callType: _callType,
}: IncomingCallActionsProps) {
  void _callType;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 0) + 48;

  return (
    <View style={[styles.root, { bottom }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={styles.slot}>
          <CallActionButton
            icon="call"
            label={t('calls.decline')}
            backgroundColor="#E53935"
            size={ACTION_BUTTON_LARGE}
            onPress={onDecline}
            iconStyle={{ transform: [{ rotate: '135deg' }] }}
            testID="incoming-call-decline"
          />
        </View>

        <View style={styles.slot}>
          {onMessage ? (
            <CallActionButton
              icon="chatbubble-ellipses"
              label={t('calls.message', { defaultValue: 'Message' })}
              backgroundColor={CALL_COLORS.messagePillBackground}
              iconColor={CALL_COLORS.messagePillText}
              size={ACTION_BUTTON_SMALL}
              onPress={onMessage}
              testID="incoming-call-message"
            />
          ) : (
            <View style={styles.messagePlaceholder} />
          )}
        </View>

        <View style={styles.slot}>
          <CallActionButton
            icon="call"
            label={t('calls.accept')}
            backgroundColor="#43A047"
            size={ACTION_BUTTON_LARGE}
            onPress={onAccept}
            testID="incoming-call-accept"
          />
        </View>
      </View>

      {onRemindLater ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('calls.remindMe', { defaultValue: 'Remind me' })}
          onPress={onRemindLater}
          style={({ pressed }) => [styles.remindBtn, pressed && styles.remindPressed]}
        >
          <Text allowFontScaling={false} style={styles.remindText}>
            {t('calls.remindMe', { defaultValue: 'Remind me' })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    width: '100%',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-evenly',
    width: '100%',
    paddingHorizontal: 24,
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    minHeight: ACTION_BUTTON_LARGE + 28,
    justifyContent: 'flex-start',
  },
  messagePlaceholder: {
    width: ACTION_BUTTON_SMALL,
    height: ACTION_BUTTON_SMALL,
  },
  remindBtn: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  remindPressed: {
    opacity: 0.7,
  },
  remindText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
    textAlign: 'center',
  },
});

export default IncomingCallActions;
