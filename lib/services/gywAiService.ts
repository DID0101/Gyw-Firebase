import { Platform } from 'react-native';
import { functions, httpsCallable as httpsCallableWebCompat } from '@/lib/firebase';
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { enqueueCloudJob } from '@/lib/offline/jobQueue';
import { retryOperation } from '@/lib/reliability/RetryManager';

export async function requestGywAiReply(params: {
  chatId: string;
  text: string;
  contextLimit?: number;
}): Promise<{ messageId: string; text: string }> {
  // On native, ALWAYS prefer RN Firebase Functions instance method.
  // Web uses the web SDK callable helper.
  const callImpl = (() => {
    if (Platform.OS === 'web') {
      const callable = httpsCallableWebCompat('gywAiReplyV1');
      return (data: any) => callable(data);
    }

    // Prefer the native singleton from rnFirebase (same app/auth).
    try {
      const { getRnFunctions } = require('@/lib/rnFirebase');
      const rnFns = getRnFunctions?.();
      const callable = rnFns?.httpsCallable?.('gywAiReplyV1', { timeout: 180000 });
      if (typeof callable === 'function') return (data: any) => callable(data);
    } catch {
      // fall through
    }

    // Fallback to whatever `lib/firebase.ts` provided (may still be RN Firebase).
    try {
      const callable = (functions as any)?.httpsCallable?.('gywAiReplyV1', { timeout: 180000 });
      if (typeof callable === 'function') return (data: any) => callable(data);
    } catch {
      // fall through
    }

    const callable = httpsCallableWebCompat('gywAiReplyV1');
    return (data: any) => callable(data);
  })();

  const payload = {
    chatId: params.chatId,
    text: params.text,
    contextLimit: params.contextLimit,
  };
  prodDebug('GYW_AI_REQUEST', {
    callable: 'gywAiReplyV1',
    platform: Platform.OS,
    chatId: params.chatId,
    textLength: params.text.length,
    textPreview: params.text.slice(0, 80),
    contextLimit: params.contextLimit ?? null,
  });

  let res: any;
  try {
    res = await retryOperation(() => callImpl(payload), {
      label: 'gywAiReplyV1',
      timeoutMs: 180000,
      maxAttempts: 3,
      waitForReconnect: true,
    });
  } catch (e: any) {
    const jobId = `gyw_ai_reply:${params.chatId}:${Date.now()}`;
    await enqueueCloudJob({
      jobId,
      type: 'gyw_ai_reply',
      params: payload as Record<string, unknown>,
    }).catch(() => undefined);
    prodDebugError('GYW_AI_ERROR', e, {
      callable: 'gywAiReplyV1',
      platform: Platform.OS,
      chatId: params.chatId,
      queued: true,
    });
    // RN Firebase callable errors: e.code / e.message / e.details
    const code = e?.code ? String(e.code) : 'unknown';
    const msg = e?.message ? String(e.message) : String(e);
    const reason = e?.details?.reason ? String(e.details.reason) : undefined;
    const status = e?.details?.status != null ? String(e.details.status) : undefined;
    const detail = [reason ? `reason=${reason}` : null, status ? `status=${status}` : null].filter(Boolean).join(' ');
    throw new Error(detail ? `${msg} (${code} ${detail})` : `${msg} (${code})`);
  }

  const data: any = (res as any)?.data ?? res;
  prodDebug('GYW_AI_RESPONSE', {
    callable: 'gywAiReplyV1',
    chatId: params.chatId,
    ok: !!data?.ok,
    messageId: data?.messageId ?? null,
    textLength: typeof data?.text === 'string' ? data.text.length : null,
    responseKeys: data && typeof data === 'object' ? Object.keys(data) : [],
  });
  if (!data?.ok || !data?.messageId || typeof data?.text !== 'string') {
    throw new Error('Gyw AI unavailable');
  }
  return { messageId: data.messageId, text: data.text };
}

const MULTIMODAL_TIMEOUT_MS = 300000;

function multimodalCallable() {
  if (Platform.OS === 'web') {
    const callable = httpsCallableWebCompat('gywAiMultimodalV1');
    return (data: any) => callable(data);
  }
  try {
    const { getRnFunctions } = require('@/lib/rnFirebase');
    const rnFns = getRnFunctions?.();
    const callable = rnFns?.httpsCallable?.('gywAiMultimodalV1', { timeout: MULTIMODAL_TIMEOUT_MS });
    if (typeof callable === 'function') return (data: any) => callable(data);
  } catch {
    /* fall through */
  }
  try {
    const callable = (functions as any)?.httpsCallable?.('gywAiMultimodalV1', { timeout: MULTIMODAL_TIMEOUT_MS });
    if (typeof callable === 'function') return (data: any) => callable(data);
  } catch {
    /* fall through */
  }
  const callable = httpsCallableWebCompat('gywAiMultimodalV1');
  return (data: any) => callable(data);
}

/** Image message must already exist in Firestore with `imageUrl` and optional `text` / `aiMode`. */
export async function requestGywAiMultimodal(params: {
  chatId: string;
  userMessageId: string;
}): Promise<{ messageId: string; kind: 'text' | 'image'; text?: string; imageUrl?: string }> {
  const callImpl = multimodalCallable();
  const payload = {
    chatId: params.chatId,
    userMessageId: params.userMessageId,
  };
  prodDebug('GYW_AI_REQUEST', {
    callable: 'gywAiMultimodalV1',
    platform: Platform.OS,
    chatId: params.chatId,
    userMessageId: params.userMessageId,
  });
  let res: any;
  try {
    res = await retryOperation(() => callImpl(payload), {
      label: 'gywAiMultimodalV1',
      timeoutMs: MULTIMODAL_TIMEOUT_MS,
      maxAttempts: 2,
      waitForReconnect: true,
    });
  } catch (e: any) {
    const jobId = `gyw_ai_multimodal:${params.chatId}:${params.userMessageId}`;
    await enqueueCloudJob({
      jobId,
      type: 'gyw_ai_multimodal',
      params: payload as Record<string, unknown>,
    }).catch(() => undefined);
    prodDebugError('GYW_AI_ERROR', e, {
      callable: 'gywAiMultimodalV1',
      platform: Platform.OS,
      chatId: params.chatId,
      userMessageId: params.userMessageId,
      queued: true,
    });
    const code = e?.code ? String(e.code) : 'unknown';
    const msg = e?.message ? String(e.message) : String(e);
    const reason = e?.details?.reason ? String(e.details.reason) : undefined;
    const status = e?.details?.status != null ? String(e.details.status) : undefined;
    const detail = [reason ? `reason=${reason}` : null, status ? `status=${status}` : null].filter(Boolean).join(' ');
    throw new Error(detail ? `${msg} (${code} ${detail})` : `${msg} (${code})`);
  }

  const data: any = (res as any)?.data ?? res;
  prodDebug('GYW_AI_RESPONSE', {
    callable: 'gywAiMultimodalV1',
    chatId: params.chatId,
    userMessageId: params.userMessageId,
    ok: !!data?.ok,
    messageId: data?.messageId ?? null,
    kind: data?.kind ?? null,
    textLength: typeof data?.text === 'string' ? data.text.length : null,
    hasImageUrl: typeof data?.imageUrl === 'string',
    responseKeys: data && typeof data === 'object' ? Object.keys(data) : [],
  });
  if (!data?.ok || !data?.messageId || (data?.kind !== 'text' && data?.kind !== 'image')) {
    throw new Error('Gyw AI unavailable');
  }
  if (data.kind === 'image' && typeof data.imageUrl !== 'string') {
    throw new Error('Gyw AI unavailable');
  }
  return {
    messageId: data.messageId,
    kind: data.kind,
    text: typeof data.text === 'string' ? data.text : undefined,
    imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
  };
}

/** Background queue processor — direct callable, no re-enqueue. */
export async function executeGywAiReplyJob(params: {
  chatId: string;
  text: string;
  contextLimit?: number;
}): Promise<void> {
  await requestGywAiReply(params);
}

export async function executeGywAiMultimodalJob(params: {
  chatId: string;
  userMessageId: string;
}): Promise<void> {
  await requestGywAiMultimodal(params);
}
