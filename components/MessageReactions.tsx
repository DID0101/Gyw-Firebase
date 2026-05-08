import { useTheme } from '@/contexts/ThemeContext';
import { ChatMessage } from '@/lib/types/chat';
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface MessageReactionsProps {
  message: ChatMessage;
  currentUserId: string;
  onReactionPress: (messageId: string, emoji: string) => void;
}

function areReactionMapsEqual(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (!Array.isArray(av) || !Array.isArray(bv)) return false;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i += 1) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}

const MessageReactions: React.FC<MessageReactionsProps> = ({
  message,
  currentUserId,
  onReactionPress,
}) => {
  const { isDark } = useTheme();
  
  // Safety check: handle undefined message
  if (!message) {
    return null;
  }
  
  // Memoize reactions to prevent unnecessary recalculations
  const reactions = useMemo(() => message.reactions || {}, [message.reactions]);
  const reactionEntries = useMemo(() => Object.entries(reactions), [reactions]);

  if (reactionEntries.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {reactionEntries.map(([emoji, userIds]) => {
        // Safety check: ensure userIds is an array
        if (!Array.isArray(userIds)) {
          return null;
        }
        
        const userReacted = userIds.includes(currentUserId);
        const count = userIds.length;
        
        return (
          <Pressable
            key={emoji}
            onPress={() => onReactionPress(message.id, emoji)}
            style={[
              styles.reactionButton,
              userReacted && styles.reactionButtonActive,
              { backgroundColor: userReacted 
                ? (isDark ? 'rgba(255, 87, 34, 0.3)' : 'rgba(255, 87, 34, 0.2)')
                : (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)')
              },
            ]}
          >
            <Text style={styles.emoji}>{emoji}</Text>
            {count > 1 && (
              <Text style={[
                styles.count,
                { color: isDark ? '#9CA3AF' : '#6B7280' }
              ]}>
                {count}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  reactionButtonActive: {
    borderWidth: 1,
    borderColor: '#FF5722',
  },
  emoji: {
    fontSize: 14,
  },
  count: {
    fontSize: 12,
    fontWeight: '500',
  },
});

// Memoize component to prevent re-renders when unrelated messages update
export default memo(MessageReactions, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.currentUserId === nextProps.currentUserId &&
    areReactionMapsEqual(prevProps.message.reactions, nextProps.message.reactions)
  );
});

