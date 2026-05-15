import { Platform } from 'react-native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  fetchChatMessagesRecentWindowNative,
  getChatParticipantsNative,
  hasNativeFirestore,
  normalizeMessageDoc,
} from '@/lib/firestoreNative';

export type GalleryMediaItem = {
  id: string;
  kind: 'image' | 'video';
  thumbUri: string;
  fullUri: string;
  createdAt: string;
};

export type ChatMediaGalleryCursor = QueryDocumentSnapshot<DocumentData> | unknown | null;

/** Messages read per page (recent-first); media extracted client-side (no composite type index required). */
const SCAN_WINDOW = 55;

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}

function firstHttpUrl(...vals: unknown[]): string {
  for (const v of vals) {
    if (isHttpUrl(v)) return v.trim();
  }
  return '';
}

/**
 * Flatten image/video URLs from a message doc (imageUrl, videoUrl, mediaUrl, attachments[], legacy missing type).
 */
export function extractGalleryItemsFromMessageDoc(
  docId: string,
  chatId: string,
  raw: Record<string, unknown>,
  filterSenderId: string | null
): GalleryMediaItem[] {
  const m = normalizeMessageDoc(docId, chatId, raw);
  if (m.deleted || m.deletedForEveryone) return [];
  if (filterSenderId && m.senderId !== filterSenderId) return [];

  const createdAt = typeof m.createdAt === 'string' ? m.createdAt : '';
  const out: GalleryMediaItem[] = [];

  const attachments = raw.attachments;
  if (Array.isArray(attachments)) {
    attachments.forEach((a: unknown, i: number) => {
      if (!a || typeof a !== 'object') return;
      const o = a as Record<string, unknown>;
      const url = firstHttpUrl(o.url, o.uri, o.src, o.mediaUrl, o.downloadURL);
      if (!url) return;
      const mime = String(o.type || o.mimeType || '').toLowerCase();
      const kindHint = String(o.kind || '').toLowerCase();
      const isVid = kindHint === 'video' || mime.includes('video');
      const isImg = kindHint === 'image' || mime.includes('image') || (!mime && !isVid);
      const thumb = firstHttpUrl(o.thumbnailUrl, o.thumbUrl, o.previewUrl) || url;
      if (isVid) {
        out.push({ id: `${docId}:att:${i}`, kind: 'video', thumbUri: thumb, fullUri: url, createdAt });
      } else if (isImg) {
        out.push({ id: `${docId}:att:${i}`, kind: 'image', thumbUri: thumb, fullUri: url, createdAt });
      }
    });
    if (out.length) return out;
  }

  const imgUrl = firstHttpUrl(raw.imageUrl, raw.mediaUrl, m.imageUrl, (m as { url?: string }).url);
  const vidUrl = firstHttpUrl(raw.videoUrl, m.videoUrl);
  const thumbVid = firstHttpUrl(raw.videoThumbnailUrl, m.videoThumbnailUrl) || vidUrl;

  const typeStr = String(m.type || raw.type || '').toLowerCase();

  if (typeStr === 'video' || vidUrl) {
    if (!vidUrl) return [];
    out.push({ id: `${docId}:main`, kind: 'video', thumbUri: thumbVid || vidUrl, fullUri: vidUrl, createdAt });
    return out;
  }

  if (typeStr === 'image' || imgUrl) {
    if (!imgUrl) return [];
    out.push({ id: `${docId}:main`, kind: 'image', thumbUri: imgUrl, fullUri: imgUrl, createdAt });
    return out;
  }

  if (vidUrl) {
    out.push({ id: `${docId}:legacyV`, kind: 'video', thumbUri: thumbVid || vidUrl, fullUri: vidUrl, createdAt });
    return out;
  }
  if (imgUrl) {
    out.push({ id: `${docId}:legacyI`, kind: 'image', thumbUri: imgUrl, fullUri: imgUrl, createdAt });
  }
  return out;
}

async function fetchScanGalleryPageWeb(
  chatId: string,
  opts: { filterSenderId: string | null; windowSize: number; cursor: ChatMediaGalleryCursor }
): Promise<{ items: GalleryMediaItem[]; nextCursor: ChatMediaGalleryCursor; docCount: number }> {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = opts.cursor
    ? query(
        messagesRef,
        orderBy('createdAt', 'desc'),
        startAfter(opts.cursor as QueryDocumentSnapshot<DocumentData>),
        limit(opts.windowSize)
      )
    : query(messagesRef, orderBy('createdAt', 'desc'), limit(opts.windowSize));
  const snapshot = await getDocs(q);
  const items: GalleryMediaItem[] = [];
  let docCount = 0;
  snapshot.forEach((docSnap) => {
    docCount += 1;
    items.push(
      ...extractGalleryItemsFromMessageDoc(docSnap.id, chatId, docSnap.data() as Record<string, unknown>, opts.filterSenderId)
    );
  });
  const docs = snapshot.docs;
  const nextCursor = docs.length > 0 ? docs[docs.length - 1]! : null;
  return { items, nextCursor, docCount };
}

async function fetchScanGalleryPageNative(
  chatId: string,
  opts: { filterSenderId: string | null; windowSize: number; cursor: ChatMediaGalleryCursor }
): Promise<{ items: GalleryMediaItem[]; nextCursor: ChatMediaGalleryCursor; docCount: number }> {
  const { messages, lastDoc, docCount } = await fetchChatMessagesRecentWindowNative(chatId, {
    cursor: opts.cursor,
    limit: opts.windowSize,
  });
  const items: GalleryMediaItem[] = [];
  for (const m of messages) {
    items.push(...extractGalleryItemsFromMessageDoc(m.id, chatId, m as unknown as Record<string, unknown>, opts.filterSenderId));
  }
  return { items, nextCursor: docCount ? lastDoc : null, docCount };
}

export type GalleryPageResult = {
  items: GalleryMediaItem[];
  nextCursor: ChatMediaGalleryCursor;
  /** True if we read a full window — caller may load more message windows. */
  mayHaveMoreMessages: boolean;
};

/**
 * Paginated gallery: loads a recent window of messages (createdAt desc only), extracts media in-app.
 * Avoids composite indexes on `type` + `createdAt` that often block queries until deployed.
 */
const MAX_EMPTY_CHAIN = 10;

export async function fetchChatMediaGalleryPage(
  chatId: string,
  opts: {
    filterSenderId: string | null;
    pageSize: number;
    cursor: ChatMediaGalleryCursor;
  }
): Promise<GalleryPageResult> {
  const windowSize = Math.max(SCAN_WINDOW, opts.pageSize);
  const combined: GalleryMediaItem[] = [];
  let cursor: ChatMediaGalleryCursor = opts.cursor;
  let lastNext: ChatMediaGalleryCursor = null;
  let lastMay = false;

  for (let step = 0; step < MAX_EMPTY_CHAIN; step++) {
    const scan =
      Platform.OS !== 'web' && hasNativeFirestore
        ? await fetchScanGalleryPageNative(chatId, {
            filterSenderId: opts.filterSenderId,
            windowSize,
            cursor,
          })
        : await fetchScanGalleryPageWeb(chatId, {
            filterSenderId: opts.filterSenderId,
            windowSize,
            cursor,
          });
    combined.push(...scan.items);
    lastNext = scan.nextCursor;
    lastMay = scan.docCount >= windowSize;
    cursor = scan.nextCursor;

    if (combined.length > 0) break;
    if (!lastMay || !cursor) break;
  }

  const seen = new Set<string>();
  const deduped: GalleryMediaItem[] = [];
  for (const it of combined) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    deduped.push(it);
  }

  return {
    items: deduped,
    nextCursor: lastNext,
    mayHaveMoreMessages: lastMay,
  };
}

export async function verifyViewerInChat(chatId: string, viewerUid: string): Promise<boolean> {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const parts = await getChatParticipantsNative(chatId);
    return !!(parts && parts.includes(viewerUid));
  }
  const snap = await getDoc(doc(db, 'chats', chatId));
  if (!snap.exists()) return false;
  const p = snap.data()?.participants;
  return Array.isArray(p) && p.includes(viewerUid);
}
