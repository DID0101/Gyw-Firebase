/**
 * Bootstrap offline-first reliability — call once at app shell mount.
 */
import { logStartupStep } from '@/lib/debug/releaseStartupTrace';
import { registerCloudJobHandler, registerCloudJobProcessor } from '@/lib/offline/jobQueue';
import { startQueueSyncManager } from '@/lib/reliability/QueueSyncManager';
import { logSync } from '@/lib/reliability/reliabilityLog';
import { initSentry } from '@/lib/reliability/SentryManager';

let started = false;

function registerCloudJobHandlers(): void {
  registerCloudJobHandler('gyw_ai_reply', async (params) => {
    const { executeGywAiReplyJob } = await import('@/lib/services/gywAiService');
    await executeGywAiReplyJob(params as { chatId: string; text: string; contextLimit?: number });
  });
  registerCloudJobHandler('gyw_ai_multimodal', async (params) => {
    const { executeGywAiMultimodalJob } = await import('@/lib/services/gywAiService');
    await executeGywAiMultimodalJob(params as { chatId: string; userMessageId: string });
  });
}

export function initReliability(): void {
  if (started) return;
  started = true;
  logStartupStep('STEP_1_APP_LAUNCHED', { phase: 'reliability_init' });
  initSentry();
  logSync('INIT_START', {});
  registerCloudJobHandlers();
  registerCloudJobProcessor();
  startQueueSyncManager();
  logSync('INIT_DONE', {});
}
