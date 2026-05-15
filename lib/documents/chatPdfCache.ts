import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const SUBDIR = 'chat_pdf_cache/';
const MAX_CACHED_FILES = 48;

function cacheRoot(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error('No document directory');
  return `${base}${SUBDIR}`;
}

export function getCachedPdfPath(messageId: string): string {
  const safeId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `${cacheRoot()}${safeId}.pdf`;
}

function toFileScheme(uri: string): string {
  if (uri.startsWith('file://')) return uri;
  return `file://${uri}`;
}

async function ensureCacheDir(): Promise<void> {
  const root = cacheRoot();
  const info = await FileSystem.getInfoAsync(root);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  }
}

/** Returns local file URI if a non-empty cached PDF exists. */
export async function getExistingCachedPdfUri(messageId: string): Promise<string | null> {
  try {
    const path = getCachedPdfPath(messageId);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists && info.size && info.size > 0) {
      return toFileScheme(path);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Download remote PDF to app document cache. Prefer react-native-blob-util on native
 * (Expo FileSystem.downloadAsync often fails on Firebase Storage URLs on Android).
 */
export async function downloadPdfToCache(remoteUrl: string, messageId: string): Promise<string> {
  await ensureCacheDir();
  const destUri = getCachedPdfPath(messageId);
  await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});

  if (Platform.OS === 'web') {
    const { uri } = await FileSystem.downloadAsync(remoteUrl, destUri);
    void pruneChatPdfCache(MAX_CACHED_FILES).catch(() => {});
    return uri;
  }

  const plainPath = destUri.replace(/^file:\/\//, '');

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNativeBlobUtil = require('react-native-blob-util').default as typeof import('react-native-blob-util').default;
    await ReactNativeBlobUtil.config({ path: plainPath, overwrite: true }).fetch('GET', remoteUrl, {
      Accept: 'application/pdf,*/*',
    });
    const info = await FileSystem.getInfoAsync(destUri);
    if (!info.exists || !info.size || info.size < 16) {
      throw new Error('empty or missing pdf after blob download');
    }
    void pruneChatPdfCache(MAX_CACHED_FILES).catch(() => {});
    return toFileScheme(plainPath);
  } catch (e) {
    if (__DEV__) console.warn('[chatPdfCache] blob download failed, trying FileSystem', e);
    const { uri } = await FileSystem.downloadAsync(remoteUrl, destUri);
    void pruneChatPdfCache(MAX_CACHED_FILES).catch(() => {});
    return uri;
  }
}

export async function pruneChatPdfCache(maxFiles: number): Promise<void> {
  try {
    const root = cacheRoot();
    const info = await FileSystem.getInfoAsync(root);
    if (!info.exists || !info.isDirectory) return;

    const names = await FileSystem.readDirectoryAsync(root);
    if (names.length <= maxFiles) return;

    const paths = names.map((n) => `${root}${n}`);
    const stats = await Promise.all(
      paths.map(async (p) => {
        try {
          const i = await FileSystem.getInfoAsync(p);
          return { p, modTime: i.modificationTime ?? 0 };
        } catch {
          return { p, modTime: 0 };
        }
      })
    );
    stats.sort((a, b) => a.modTime - b.modTime);
    const excess = stats.slice(0, stats.length - maxFiles);
    await Promise.all(excess.map((s) => FileSystem.deleteAsync(s.p, { idempotent: true })));
  } catch {
    /* ignore prune errors */
  }
}
