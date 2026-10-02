/**
 * Durable queue for long-running Cloud Function jobs (AI, future audiobook pipeline).
 */
import {
  enqueueOfflineItem,
  registerQueueProcessor,
  removeOfflineItem,
} from '@/lib/reliability/OfflineQueue';
import { logQueue } from '@/lib/reliability/reliabilityLog';

export const CLOUD_JOB_QUEUE = 'cloud_function_job';

export type CloudJobPayload = {
  jobId: string;
  type: 'gyw_ai_reply' | 'gyw_ai_multimodal';
  params: Record<string, unknown>;
};

type JobHandler = (params: Record<string, unknown>) => Promise<void>;

const handlers = new Map<CloudJobPayload['type'], JobHandler>();

export function registerCloudJobHandler(type: CloudJobPayload['type'], handler: JobHandler): void {
  handlers.set(type, handler);
}

export async function enqueueCloudJob(job: CloudJobPayload): Promise<void> {
  await enqueueOfflineItem(CLOUD_JOB_QUEUE, job.jobId, job);
  logQueue('CLOUD_JOB_ENQUEUE', { type: job.type, jobId: job.jobId });
}

export function registerCloudJobProcessor(): void {
  registerQueueProcessor(CLOUD_JOB_QUEUE, async (payload) => {
    const job = payload as CloudJobPayload;
    const handler = handlers.get(job.type);
    if (!handler) {
      logQueue('CLOUD_JOB_NO_HANDLER', { type: job.type });
      return;
    }
    await handler(job.params);
    await removeOfflineItem(CLOUD_JOB_QUEUE, job.jobId);
    logQueue('CLOUD_JOB_DONE', { type: job.type, jobId: job.jobId });
  });
}
