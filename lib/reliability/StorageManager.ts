/**
 * Offline-first durable queues — MMKV on native, AsyncStorage fallback on web.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { logQueue } from '@/lib/reliability/reliabilityLog';

export type QueueName =
  | 'pendingMessages'
  | 'pendingSignups'
  | 'pendingUploads'
  | 'failedRequestsQueue';

export type QueueItem<T = unknown> = {
  id: string;
  payload: T;
  createdAt: string;
  attempts: number;
};

const QUEUE_PREFIX = 'reliability:queue:';
const MMKV_ID = 'gyw-reliability';

function queueKey(name: QueueName): string {
  return `${QUEUE_PREFIX}${name}`;
}

function getMmkvInstance(): import('react-native-mmkv').MMKV | null {
  if (Platform.OS === 'web') return null;
  try {
    const { MMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
    return new MMKV({ id: MMKV_ID });
  } catch {
    return null;
  }
}

async function readRaw(key: string): Promise<string | null> {
  const mmkv = getMmkvInstance();
  if (mmkv) {
    return mmkv.getString(key) ?? null;
  }
  return AsyncStorage.getItem(key);
}

async function writeRaw(key: string, value: string | null): Promise<void> {
  const mmkv = getMmkvInstance();
  if (mmkv) {
    if (value == null) mmkv.delete(key);
    else mmkv.set(key, value);
    return;
  }
  if (value == null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, value);
}

async function readQueue(name: QueueName): Promise<QueueItem[]> {
  try {
    const raw = await readRaw(queueKey(name));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(name: QueueName, items: QueueItem[]): Promise<void> {
  try {
    if (items.length === 0) {
      await writeRaw(queueKey(name), null);
      return;
    }
    await writeRaw(queueKey(name), JSON.stringify(items));
  } catch {
    /* non-fatal */
  }
}

export async function getQueue<T = unknown>(name: QueueName): Promise<QueueItem<T>[]> {
  return (await readQueue(name)) as QueueItem<T>[];
}

export async function addToQueue<T>(
  name: QueueName,
  id: string,
  payload: T,
  attempts = 0
): Promise<void> {
  const list = await readQueue(name);
  const idx = list.findIndex((e) => e.id === id);
  const item: QueueItem<T> = {
    id,
    payload,
    createdAt: new Date().toISOString(),
    attempts: idx >= 0 ? list[idx]!.attempts : attempts,
  };
  if (idx >= 0) list[idx] = item as QueueItem;
  else list.push(item as QueueItem);
  await writeQueue(name, list);
  logQueue('ADD', { queue: name, id, size: list.length });
}

export async function removeFromQueue(name: QueueName, id: string): Promise<void> {
  const list = await readQueue(name);
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length) return;
  await writeQueue(name, next);
  logQueue('REMOVE', { queue: name, id, size: next.length });
}

export async function clearQueue(name: QueueName): Promise<void> {
  await writeQueue(name, []);
  logQueue('CLEAR', { queue: name });
}

export async function replaceQueue(name: QueueName, items: QueueItem[]): Promise<void> {
  await writeQueue(name, items);
  logQueue('REPLACE', { queue: name, size: items.length });
}

export async function getQueueSize(name: QueueName): Promise<number> {
  return (await readQueue(name)).length;
}

/** Migrate legacy AsyncStorage queues into MMKV-backed queues on first boot. */
export async function migrateLegacyQueues(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('messageOutbox:v1');
    if (raw) {
      const legacy = JSON.parse(raw) as Array<{ tempId?: string }>;
      if (Array.isArray(legacy)) {
        for (const entry of legacy) {
          const id = entry.tempId;
          if (!id) continue;
          await addToQueue('pendingMessages', id, entry);
        }
        await AsyncStorage.removeItem('messageOutbox:v1');
        logQueue('MIGRATE_LEGACY', { from: 'messageOutbox:v1', count: legacy.length });
      }
    }
  } catch {
    /* non-fatal */
  }

  const offlineTypes: { suffix: string; queue: QueueName }[] = [
    { suffix: 'user_profile_write', queue: 'pendingSignups' },
    { suffix: 'cloud_function_job', queue: 'failedRequestsQueue' },
  ];
  for (const { suffix, queue } of offlineTypes) {
    try {
      const key = `offlineQueue:v1:${suffix}`;
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const legacy = JSON.parse(raw) as Array<{ id: string; payload: unknown }>;
      if (!Array.isArray(legacy)) continue;
      for (const entry of legacy) {
        if (!entry.id) continue;
        await addToQueue(queue, entry.id, entry.payload ?? entry);
      }
      await AsyncStorage.removeItem(key);
      logQueue('MIGRATE_LEGACY', { from: key, queue, count: legacy.length });
    } catch {
      /* non-fatal */
    }
  }
}
