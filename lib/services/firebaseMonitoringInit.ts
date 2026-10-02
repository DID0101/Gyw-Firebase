/**
 * Bootstraps Firebase Crashlytics, Performance, and Analytics on native builds.
 */
import * as Linking from 'expo-linking';
import { InteractionManager } from 'react-native';

import {
  logStartupFail,
  logStartupStep,
  verifyFirebaseNativeModules,
} from '@/lib/debug/releaseStartupTrace';
import { initAnalytics } from '@/lib/services/analyticsService';
import { initCrashlytics } from '@/lib/services/crashlyticsService';
import { markAppStartupTraceEnd, markAppStartupTraceStart } from '@/lib/services/performanceService';

function maybeRunAnalyticsChecklist(url: string | null | undefined): void {
  if (!__DEV__ || !url?.includes('analytics-checklist')) return;
  void import('@/lib/debug/runAnalyticsChecklist').then(({ runAnalyticsChecklist }) =>
    runAnalyticsChecklist()
  );
}

export function initFirebaseMonitoring(): void {
  try {
    logStartupStep('STEP_2_FIREBASE_INIT', { phase: 'monitoring_start' });
    verifyFirebaseNativeModules();
    initCrashlytics();
    logStartupStep('STEP_4_CRASHLYTICS_INIT', { ok: true });
    markAppStartupTraceStart();
    logStartupStep('STEP_5_PERFORMANCE_INIT', { trace: 'app_startup' });
    void initAnalytics().then(() => {
      logStartupStep('STEP_3_ANALYTICS_INIT', { ok: true });
    }).catch((e) => {
      logStartupFail('STEP_3_ANALYTICS_INIT', e);
    });
  } catch (e) {
    logStartupFail('STEP_2_FIREBASE_INIT', e);
  }

  if (__DEV__) {
    void Linking.getInitialURL().then(maybeRunAnalyticsChecklist);
    Linking.addEventListener('url', (event) => maybeRunAnalyticsChecklist(event.url));
  }

  InteractionManager.runAfterInteractions(() => {
    void markAppStartupTraceEnd();
  });
}
