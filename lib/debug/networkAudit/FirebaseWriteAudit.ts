/**
 * Patches Firebase write entry points to count presence/status writes (dev only).
 */
import { DebugLogger } from '@/lib/debug/networkAudit/DebugLogger';
import { recordPresenceWrite, type PresenceWriteKind } from '@/lib/debug/networkAudit/PresenceAudit';

let installed = false;

function classifyWriteData(data: unknown): PresenceWriteKind | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if ('lastActive' in d) return 'lastActive';
  if ('isOnline' in d) return 'isOnline';
  if (Object.keys(d).some((k) => k.startsWith('typing.'))) return 'typing';
  if (Object.keys(d).some((k) => k.startsWith('readState.') || k.startsWith('unreadCount.'))) return 'readState';
  return null;
}

function patchObjectMethods(target: Record<string, unknown>, label: string): void {
  for (const method of ['setDoc', 'updateDoc'] as const) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    target[method] = async (...args: unknown[]) => {
      const data = args[1];
      const kind = classifyWriteData(data);
      if (kind) {
        recordPresenceWrite(kind, { via: label, keys: data && typeof data === 'object' ? Object.keys(data as object).slice(0, 6) : [] });
      }
      return (original as (...a: unknown[]) => Promise<unknown>).apply(target, args);
    };
  }
}

export function installFirebaseWriteAudit(): void {
  if (!__DEV__ || installed) return;
  installed = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnFs = require('@react-native-firebase/firestore');
    patchObjectMethods(rnFs as Record<string, unknown>, 'native-firestore');
  } catch {
    /* web / tests */
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webFs = require('firebase/firestore') as Record<string, unknown>;
    patchObjectMethods(webFs, 'web-firestore');
  } catch {
    /* native-only build */
  }

  DebugLogger.logPresence('FIREBASE_WRITE_AUDIT_INSTALLED', {});
}
