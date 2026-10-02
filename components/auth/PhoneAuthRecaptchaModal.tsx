import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from 'react-native';
import type { WebView } from 'react-native-webview';
import { WebView as RNWebView } from 'react-native-webview';

import {
  registerInvisibleRecaptchaFallback,
  registerVisibleRecaptchaFallback,
  unregisterInvisibleRecaptchaFallback,
  unregisterVisibleRecaptchaFallback,
} from '@/lib/auth/phoneAuthRecaptchaBridge';
import {
  buildInvisibleRecaptchaHtml,
  buildVisibleRecaptchaHtml,
  RECAPTCHA_BASE_URL,
} from '@/lib/auth/recaptchaWebHtml';
import { prodDebugError } from '@/lib/debug/prodDebug';

const VISIBLE_TIMEOUT_MS = 90_000;
const INVISIBLE_TIMEOUT_MS = 45_000;

/**
 * reCAPTCHA for server phone OTP fallback on native.
 * Primary: invisible (silent, no checkbox). Visible modal is last-resort only.
 */
export default function PhoneAuthRecaptchaModal() {
  const visibleWebRef = useRef<WebView>(null);
  const invisibleWebRef = useRef<WebView>(null);

  const [visibleActive, setVisibleActive] = useState(false);
  const [visibleWebViewKey, setVisibleWebViewKey] = useState(0);
  const [checkboxReady, setCheckboxReady] = useState(false);

  const [invisibleActive, setInvisibleActive] = useState(false);
  const [invisibleWebViewKey, setInvisibleWebViewKey] = useState(0);

  const visibleResolverRef = useRef<((token: string) => void) | null>(null);
  const visibleRejecterRef = useRef<((err: Error) => void) | null>(null);
  const invisibleResolverRef = useRef<((token: string) => void) | null>(null);
  const invisibleRejecterRef = useRef<((err: Error) => void) | null>(null);
  const visibleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invisibleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishVisible = useCallback((fn: () => void) => {
    if (visibleTimeoutRef.current) {
      clearTimeout(visibleTimeoutRef.current);
      visibleTimeoutRef.current = null;
    }
    setVisibleActive(false);
    setCheckboxReady(false);
    fn();
    visibleResolverRef.current = null;
    visibleRejecterRef.current = null;
  }, []);

  const finishInvisible = useCallback((fn: () => void) => {
    if (invisibleTimeoutRef.current) {
      clearTimeout(invisibleTimeoutRef.current);
      invisibleTimeoutRef.current = null;
    }
    setInvisibleActive(false);
    fn();
    invisibleResolverRef.current = null;
    invisibleRejecterRef.current = null;
  }, []);

  const runVisibleRecaptcha = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      visibleResolverRef.current = resolve;
      visibleRejecterRef.current = reject;
      setCheckboxReady(false);
      setVisibleWebViewKey((k) => k + 1);
      setVisibleActive(true);
      visibleTimeoutRef.current = setTimeout(() => {
        prodDebugError('AUTH_RECAPTCHA_TIMEOUT', new Error('reCAPTCHA timed out'), {
          platform: Platform.OS,
          mode: 'visible',
        });
        finishVisible(() => visibleRejecterRef.current?.(new Error('Verification timed out. Try again.')));
      }, VISIBLE_TIMEOUT_MS);
    });
  }, [finishVisible]);

  const runInvisibleRecaptcha = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      invisibleResolverRef.current = resolve;
      invisibleRejecterRef.current = reject;
      setInvisibleWebViewKey((k) => k + 1);
      setInvisibleActive(true);
      invisibleTimeoutRef.current = setTimeout(() => {
        prodDebugError('AUTH_RECAPTCHA_TIMEOUT', new Error('Silent reCAPTCHA timed out'), {
          platform: Platform.OS,
          mode: 'invisible',
        });
        finishInvisible(() =>
          invisibleRejecterRef.current?.(new Error('Silent verification timed out. Try again.')),
        );
      }, INVISIBLE_TIMEOUT_MS);
    });
  }, [finishInvisible]);

  useEffect(() => {
    registerVisibleRecaptchaFallback(runVisibleRecaptcha);
    registerInvisibleRecaptchaFallback(runInvisibleRecaptcha);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[AUTH_PHONE] AUTH_RECAPTCHA_MODAL_REGISTERED', { invisible: true, visible: true });
    }
    return () => {
      unregisterVisibleRecaptchaFallback();
      unregisterInvisibleRecaptchaFallback();
    };
  }, [runVisibleRecaptcha, runInvisibleRecaptcha]);

  const cancelVisible = useCallback(() => {
    finishVisible(() => visibleRejecterRef.current?.(new Error('Verification cancelled')));
  }, [finishVisible]);

  if (Platform.OS === 'web') return null;

  return (
    <>
      {/* Silent invisible reCAPTCHA — off-screen, no UI */}
      {invisibleActive ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
        >
          <RNWebView
            key={`inv-${invisibleWebViewKey}`}
            ref={invisibleWebRef}
            source={{ html: buildInvisibleRecaptchaHtml(), baseUrl: RECAPTCHA_BASE_URL }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            mixedContentMode="always"
            style={{ width: 1, height: 1 }}
            onMessage={(event) => {
              try {
                const data = JSON.parse(event.nativeEvent.data) as {
                  ok?: boolean;
                  token?: string;
                  ready?: boolean;
                  error?: string;
                };
                if (data.ready) {
                  if (__DEV__) {
                    // eslint-disable-next-line no-console
                    console.log('[AUTH_PHONE] AUTH_RECAPTCHA_INVISIBLE_READY');
                  }
                  invisibleWebRef.current?.injectJavaScript('window.runVerify && window.runVerify(); true;');
                  return;
                }
                if (data.ok && data.token) {
                  if (__DEV__) {
                    // eslint-disable-next-line no-console
                    console.log('[AUTH_PHONE] AUTH_RECAPTCHA_TOKEN_OK', {
                      tokenLength: data.token.length,
                      mode: 'invisible',
                    });
                  }
                  finishInvisible(() => invisibleResolverRef.current?.(data.token!));
                  return;
                }
                if (data.error) {
                  finishInvisible(() => invisibleRejecterRef.current?.(new Error(data.error!)));
                }
              } catch {
                finishInvisible(() =>
                  invisibleRejecterRef.current?.(new Error('Invalid reCAPTCHA response')),
                );
              }
            }}
            onError={(e) =>
              finishInvisible(() =>
                invisibleRejecterRef.current?.(
                  new Error(`WebView error: ${e.nativeEvent.description}`),
                ),
              )
            }
          />
        </View>
      ) : null}

      {/* Visible checkbox — only when explicitly requested */}
      <Modal visible={visibleActive} transparent animationType="fade" onRequestClose={cancelVisible}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.55)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 360,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 20,
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111', textAlign: 'center' }}>
              Security check
            </Text>
            <Text style={{ fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20 }}>
              Tap the checkbox below, then wait a moment while we send your code.
            </Text>

            <View style={{ minHeight: 84, alignItems: 'center', justifyContent: 'center' }}>
              {visibleActive ? (
                <RNWebView
                  key={visibleWebViewKey}
                  ref={visibleWebRef}
                  source={{ html: buildVisibleRecaptchaHtml(), baseUrl: RECAPTCHA_BASE_URL }}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  domStorageEnabled
                  thirdPartyCookiesEnabled
                  sharedCookiesEnabled
                  mixedContentMode="always"
                  setSupportMultipleWindows
                  style={{ width: 304, height: 78, backgroundColor: 'transparent' }}
                  onMessage={(event) => {
                    try {
                      const data = JSON.parse(event.nativeEvent.data) as {
                        ok?: boolean;
                        token?: string;
                        ready?: boolean;
                        error?: string;
                      };
                      if (data.ready) {
                        setCheckboxReady(true);
                        if (__DEV__) {
                          // eslint-disable-next-line no-console
                          console.log('[AUTH_PHONE] AUTH_RECAPTCHA_MODAL_READY');
                        }
                        return;
                      }
                      if (data.ok && data.token) {
                        if (__DEV__) {
                          // eslint-disable-next-line no-console
                          console.log('[AUTH_PHONE] AUTH_RECAPTCHA_TOKEN_OK', {
                            tokenLength: data.token.length,
                            mode: 'visible',
                          });
                        }
                        finishVisible(() => visibleResolverRef.current?.(data.token!));
                        return;
                      }
                      if (data.error) {
                        finishVisible(() => visibleRejecterRef.current?.(new Error(data.error!)));
                      }
                    } catch {
                      finishVisible(() =>
                        visibleRejecterRef.current?.(new Error('Invalid reCAPTCHA response')),
                      );
                    }
                  }}
                  onError={(e) =>
                    finishVisible(() =>
                      visibleRejecterRef.current?.(
                        new Error(`WebView error: ${e.nativeEvent.description}`),
                      ),
                    )
                  }
                />
              ) : null}
              {!checkboxReady ? (
                <View
                  style={{ position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <ActivityIndicator color="#FF5722" size="small" />
                  <Text style={{ fontSize: 13, color: '#666' }}>Loading verification…</Text>
                </View>
              ) : null}
            </View>

            <Pressable onPress={cancelVisible} style={{ alignSelf: 'center', paddingVertical: 8 }}>
              <Text style={{ color: '#FF5722', fontSize: 15, fontWeight: '500' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
