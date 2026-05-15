import { Platform } from 'react-native';
import { functions, httpsCallable as httpsCallableWebCompat } from '@/lib/firebase';

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

  let res: any;
  try {
    res = await callImpl({
      chatId: params.chatId,
      text: params.text,
      contextLimit: params.contextLimit,
    });
  } catch (e: any) {
    // RN Firebase callable errors: e.code / e.message / e.details
    const code = e?.code ? String(e.code) : 'unknown';
    const msg = e?.message ? String(e.message) : String(e);
    const reason = e?.details?.reason ? String(e.details.reason) : undefined;
    const status = e?.details?.status != null ? String(e.details.status) : undefined;
    const detail = [reason ? `reason=${reason}` : null, status ? `status=${status}` : null].filter(Boolean).join(' ');
    throw new Error(detail ? `${msg} (${code} ${detail})` : `${msg} (${code})`);
  }

  const data: any = (res as any)?.data ?? res;
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
  let res: any;
  try {
    res = await callImpl({
      chatId: params.chatId,
      userMessageId: params.userMessageId,
    });
  } catch (e: any) {
    const code = e?.code ? String(e.code) : 'unknown';
    const msg = e?.message ? String(e.message) : String(e);
    const reason = e?.details?.reason ? String(e.details.reason) : undefined;
    const status = e?.details?.status != null ? String(e.details.status) : undefined;
    const detail = [reason ? `reason=${reason}` : null, status ? `status=${status}` : null].filter(Boolean).join(' ');
    throw new Error(detail ? `${msg} (${code} ${detail})` : `${msg} (${code})`);
  }

  const data: any = (res as any)?.data ?? res;
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
