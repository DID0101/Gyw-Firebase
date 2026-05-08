import { NativeModules, Platform } from 'react-native';

type ChatNotificationBridgeNative = {
  setForegroundChatId: (chatId: string | null) => void;
  setChatUnreadTotal: (total: number) => Promise<void>;
  clearChatNotifications: (chatId: string) => Promise<void>;
  consumePendingReplyJson: () => Promise<string | null>;
};

const bridge: ChatNotificationBridgeNative | undefined =
  Platform.OS === 'android' ? (NativeModules.ChatNotificationBridge as ChatNotificationBridgeNative) : undefined;

export function setAndroidForegroundChatId(chatId: string | null): void {
  bridge?.setForegroundChatId?.(chatId);
}

export function setAndroidChatUnreadTotal(total: number): Promise<void> {
  return bridge?.setChatUnreadTotal?.(total) ?? Promise.resolve();
}

export function clearAndroidChatNotifications(chatId: string): Promise<void> {
  return bridge?.clearChatNotifications?.(chatId) ?? Promise.resolve();
}

export function consumeAndroidPendingReplyJson(): Promise<string | null> {
  return bridge?.consumePendingReplyJson?.() ?? Promise.resolve(null);
}
