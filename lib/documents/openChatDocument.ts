import type { ChatMessage } from '@/lib/types/chat';
import { isPdfDocument } from '@/lib/documents/documentUpload';
import * as FileSystem from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';

type DocumentOpenMessage = Pick<ChatMessage, 'id' | 'fileUrl' | 'fileName' | 'mimeType' | 'extension'>;

export type OpenChatDocumentNav = {
  /** Expo Router instance from `useRouter()` */
  push: (href: { pathname: string; params: Record<string, string> }) => void;
};

/**
 * Opens a chat attachment.
 * - PDF: navigates to in-app PDF viewer (no browser / no `Linking.openURL` on Firebase URLs).
 * - Other types: downloads to cache and opens the system share sheet (or Linking for local file fallback).
 */
export function openChatDocument(
  message: DocumentOpenMessage,
  t: (key: string) => string,
  options?: { nav: OpenChatDocumentNav; chatId: string }
): void {
  const url = message.fileUrl?.trim();
  if (!url) {
    Alert.alert(t('common.error'), t('messages.documentInvalid'));
    return;
  }

  const pdf = isPdfDocument(message.mimeType, message.extension);

  if (pdf) {
    if (!options?.nav?.push || !options.chatId) {
      Alert.alert(t('common.error'), t('messages.pdfLoadError'));
      return;
    }
    const titleRaw = message.fileName?.trim() || 'PDF';
    // Do not pass fileUrl in route params — Firebase URLs are long and Expo Router can truncate them.
    options.nav.push({
      pathname: '/(home)/(modal)/pdf-viewer',
      params: {
        chatId: options.chatId,
        messageId: message.id,
        title: encodeURIComponent(titleRaw),
      },
    });
    return;
  }

  void openNonPdfAttachment(message, url, t);
}

async function openNonPdfAttachment(
  message: DocumentOpenMessage,
  url: string,
  t: (key: string) => string
): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const w = typeof globalThis !== 'undefined' ? (globalThis as unknown as { open?: (u: string) => void }).open : undefined;
      if (w) {
        w(url);
        return;
      }
      await Linking.openURL(url);
      return;
    }

    const base = FileSystem.cacheDirectory;
    if (!base) {
      Alert.alert(t('common.error'), t('messages.openDocumentFailed'));
      return;
    }

    const ext =
      (message.extension || 'bin').replace(/^\./, '').replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin';
    const safeStem = (message.fileName || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
    const dest = `${base}chat_doc_${message.id}_${safeStem}.${ext}`;

    const { uri } = await FileSystem.downloadAsync(url, dest);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: message.mimeType || undefined,
        dialogTitle: message.fileName || t('messages.document'),
      });
    } else {
      await Linking.openURL(uri);
    }
  } catch (e) {
    if (__DEV__) console.warn('openNonPdfAttachment', e);
    Alert.alert(t('common.error'), t('messages.openDocumentFailed'));
  }
}
