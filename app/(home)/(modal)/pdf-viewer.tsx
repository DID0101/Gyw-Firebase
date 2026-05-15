import { fetchMessageFileUrl } from '@/lib/documents/refreshMessageFileUrl';
import { downloadPdfToCache, getExistingCachedPdfUri } from '@/lib/documents/chatPdfCache';
import { useTheme } from '@/contexts/ThemeContext';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Params = {
  chatId?: string;
  messageId?: string;
  title?: string;
};

function WebPdfEmbed({ url, title }: { url: string; title: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        revoked = u;
        setObjectUrl(u);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'load failed');
      }
    })();
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url]);

  if (err) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{err}</Text>
      </View>
    );
  }

  if (!objectUrl) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF5722" />
      </View>
    );
  }

  return (
    <embed
      title={title}
      src={objectUrl}
      type="application/pdf"
      style={{ width: '100%', height: '100%', border: 'none' } as CSSProperties}
    />
  );
}

export default function PdfViewerModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';
  const params = useLocalSearchParams<Params>();
  const chatId = typeof params.chatId === 'string' ? params.chatId : '';
  const messageId = typeof params.messageId === 'string' ? params.messageId : '';
  const title =
    typeof params.title === 'string' ? decodeURIComponent(params.title) : t('messages.document');

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>(() =>
    Platform.OS === 'web' ? 'loading' : 'loading'
  );
  const [errorText, setErrorText] = useState<string | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [webRemoteUrl, setWebRemoteUrl] = useState<string | null>(null);

  const screenW = Dimensions.get('window').width;

  const load = useCallback(async () => {
    if (!chatId || !messageId) {
      setErrorText(t('messages.documentInvalid'));
      setPhase('error');
      return;
    }

    setErrorText(null);
    setPhase('loading');

    try {
      const cached = await getExistingCachedPdfUri(messageId);
      if (cached) {
        setLocalUri(cached);
        setPhase('ready');
        return;
      }

      let remoteUrl = await fetchMessageFileUrl(chatId, messageId);
      if (!remoteUrl) {
        setErrorText(t('messages.pdfLoadError'));
        setPhase('error');
        return;
      }

      try {
        const uri = await downloadPdfToCache(remoteUrl, messageId);
        setLocalUri(uri);
        setPhase('ready');
      } catch (firstErr) {
        if (__DEV__) console.warn('[pdf-viewer] first download failed', firstErr);
        const fresh = await fetchMessageFileUrl(chatId, messageId);
        if (fresh && fresh !== remoteUrl) {
          const uri = await downloadPdfToCache(fresh, messageId);
          setLocalUri(uri);
          setPhase('ready');
          return;
        }
        throw firstErr;
      }
    } catch (e) {
      if (__DEV__) console.warn('[pdf-viewer] load', e);
      setErrorText(t('messages.pdfLoadError'));
      setPhase('error');
    }
  }, [chatId, messageId, t]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      (async () => {
        if (!chatId || !messageId) {
          setErrorText(t('messages.documentInvalid'));
          setPhase('error');
          return;
        }
        const u = await fetchMessageFileUrl(chatId, messageId);
        if (!u) {
          setErrorText(t('messages.pdfLoadError'));
          setPhase('error');
          return;
        }
        setWebRemoteUrl(u);
        setPhase('ready');
      })();
      return;
    }
    void load();
  }, [load, chatId, messageId, t]);

  const headerTint = isDark ? '#ffffff' : '#111827';
  const surface = isDark ? '#111827' : '#f3f4f6';

  const NativePdf =
    Platform.OS === 'web'
      ? null
      : // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('react-native-pdf').default as typeof import('react-native-pdf').default);

  useLayoutEffect(() => {
    const headerTitle = title.length > 28 ? `${title.slice(0, 26)}…` : title;
    navigation.setOptions({
      title: headerTitle,
      headerStyle: { backgroundColor: isDark ? '#111827' : '#ffffff' },
      headerTintColor: headerTint,
      headerRight: () => (
        <Pressable
          onPress={() => router.dismiss()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={{ paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <Feather name="x" size={22} color={headerTint} />
        </Pressable>
      ),
    });
  }, [navigation, router, title, headerTint, isDark, t]);

  return (
    <View style={[styles.root, { backgroundColor: surface, paddingBottom: insets.bottom }]}>
      {Platform.OS === 'web' && phase === 'ready' && webRemoteUrl ? (
        <WebPdfEmbed url={webRemoteUrl} title={title} />
      ) : null}

      {Platform.OS === 'web' && phase === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF5722" />
          <Text style={[styles.hint, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
            {t('messages.pdfLoading')}
          </Text>
        </View>
      ) : null}

      {Platform.OS === 'web' && phase === 'error' ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: isDark ? '#fecaca' : '#991b1b' }]}>
            {errorText || t('messages.pdfLoadError')}
          </Text>
          <Pressable
            onPress={() => {
              setPhase('loading');
              setErrorText(null);
              setWebRemoteUrl(null);
              void (async () => {
                if (!chatId || !messageId) return;
                const u = await fetchMessageFileUrl(chatId, messageId);
                if (!u) {
                  setErrorText(t('messages.pdfLoadError'));
                  setPhase('error');
                  return;
                }
                setWebRemoteUrl(u);
                setPhase('ready');
              })();
            }}
            style={({ pressed }) => [
              styles.retryBtn,
              { opacity: pressed ? 0.85 : 1, backgroundColor: '#FF5722' },
            ]}
          >
            <Text style={styles.retryLabel}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {Platform.OS !== 'web' && phase === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF5722" />
          <Text style={[styles.hint, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
            {t('messages.pdfLoading')}
          </Text>
        </View>
      ) : null}

      {Platform.OS !== 'web' && phase === 'error' ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: isDark ? '#fecaca' : '#991b1b' }]}>
            {errorText || t('messages.pdfLoadError')}
          </Text>
          <Pressable
            onPress={() => void load()}
            style={({ pressed }) => [
              styles.retryBtn,
              { opacity: pressed ? 0.85 : 1, backgroundColor: '#FF5722' },
            ]}
          >
            <Text style={styles.retryLabel}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      {Platform.OS !== 'web' && phase === 'ready' && localUri && NativePdf ? (
        <NativePdf
          source={{ uri: localUri, cache: false }}
          trustAllCerts
          style={{ flex: 1, width: screenW, backgroundColor: isDark ? '#1f2937' : '#e5e7eb' }}
          enablePaging={false}
          horizontal={false}
          spacing={10}
          renderActivityIndicator={(p) => (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#FF5722" />
              <Text style={[styles.hint, { color: isDark ? '#9ca3af' : '#6b7280' }]}>
                {`${Math.round((p || 0) * 100)}%`}
              </Text>
            </View>
          )}
          onError={() => {
            setErrorText(t('messages.pdfLoadError'));
            setPhase('error');
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { marginTop: 12, fontSize: 14 },
  errorText: { fontSize: 15, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryLabel: { color: '#ffffff', fontWeight: '600', fontSize: 15 },
});
