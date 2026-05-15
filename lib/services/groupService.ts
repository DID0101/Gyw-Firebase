import { Platform } from 'react-native';
import { functions, httpsCallable } from '@/lib/firebase';

/**
 * RN + web: must use modular `httpsCallable(functions, name, opts?)` with the same
 * `functions` instance as `lib/firebase.ts` (native → getRnFunctions/us-central1).
 * Calling `httpsCallable(name)` alone hits the wrong endpoint and returns NOT_FOUND.
 */
function groupHttpsCallable<TReq, TRes>(name: string, timeoutMs: number) {
  if (Platform.OS === 'web') {
    return httpsCallable<TReq, TRes>(functions, name);
  }
  // RN modular API: third arg is timeout ms (types may omit it).
  return (httpsCallable as any)(functions, name, { timeout: timeoutMs });
}

function mapGroupFnError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  const msg = String(e?.message ?? err ?? '');
  const code = e?.code ?? '';
  if (
    code === 'functions/not-found' ||
    msg.includes('NOT_FOUND') ||
    msg.includes('not-found')
  ) {
    throw new Error(
      'Cloud Function missing (NOT_FOUND). Deploy group callables: firebase deploy --only functions:createGroupV1,functions:leaveGroupV1,functions:addGroupMembersV1,functions:updateGroupInfoV1'
    );
  }
  throw err instanceof Error ? err : new Error(String(err));
}

export async function createGroupOnServer(params: {
  name: string;
  description?: string;
  participantIds: string[];
}): Promise<string> {
  try {
    const call = groupHttpsCallable<
      { name: string; description?: string; participantIds: string[] },
      { ok: true; chatId: string }
    >('createGroupV1', 25000);
    const res = await call({
      name: params.name.trim(),
      ...(params.description?.trim() ? { description: params.description.trim() } : {}),
      participantIds: params.participantIds,
    });
    const data = (res as any)?.data ?? res;
    if (!data?.ok || typeof data.chatId !== 'string') throw new Error('createGroup failed');
    return data.chatId;
  } catch (err) {
    mapGroupFnError(err);
  }
}

export async function leaveGroupOnServer(chatId: string): Promise<void> {
  try {
    const call = groupHttpsCallable<{ chatId: string }, { ok: true }>('leaveGroupV1', 20000);
    const res = await call({ chatId });
    const data = (res as any)?.data ?? res;
    if (!data?.ok) throw new Error('leaveGroup failed');
  } catch (err) {
    mapGroupFnError(err);
  }
}

export async function addGroupMembersOnServer(chatId: string, newMemberIds: string[]): Promise<string[]> {
  try {
    const call = groupHttpsCallable<
      { chatId: string; newMemberIds: string[] },
      { ok: true; added: string[] }
    >('addGroupMembersV1', 25000);
    const res = await call({ chatId, newMemberIds });
    const data = (res as any)?.data ?? res;
    if (!data?.ok || !Array.isArray(data.added)) throw new Error('addGroupMembers failed');
    return data.added;
  } catch (err) {
    mapGroupFnError(err);
  }
}

export async function updateGroupInfoOnServer(
  chatId: string,
  patch: { name?: string; description?: string; avatarUrl?: string }
): Promise<void> {
  try {
    const call = groupHttpsCallable<
      { chatId: string; name?: string; description?: string; avatarUrl?: string },
      { ok: true }
    >('updateGroupInfoV1', 20000);
    const res = await call({ chatId, ...patch });
    const data = (res as any)?.data ?? res;
    if (!data?.ok) throw new Error('updateGroupInfo failed');
  } catch (err) {
    mapGroupFnError(err);
  }
}
