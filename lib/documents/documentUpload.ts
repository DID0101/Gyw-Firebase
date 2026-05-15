/** Allowed chat document MIME types + optional zip. Used for picker filter and validation. */
export const DOCUMENT_PICKER_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
] as const;

const EXTENSION_TO_MIME = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['txt', 'text/plain'],
  ['zip', 'application/zip'],
]);

const ALLOWED_MIMES = new Set<string>(DOCUMENT_PICKER_MIME_TYPES);

export const MAX_CHAT_DOCUMENT_BYTES = 100 * 1024 * 1024;

export function extensionFromFileName(fileName: string | null | undefined): string {
  if (!fileName || !fileName.includes('.')) return '';
  const part = fileName.split('.').pop()?.trim().toLowerCase() ?? '';
  return part.replace(/[^a-z0-9]/g, '').slice(0, 12);
}

export function guessExtensionFromMime(mimeType: string | null | undefined): string {
  const m = (mimeType || '').toLowerCase().split(';')[0].trim();
  switch (m) {
    case 'application/pdf':
      return 'pdf';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'application/vnd.ms-powerpoint':
      return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'pptx';
    case 'text/plain':
      return 'txt';
    case 'application/zip':
      return 'zip';
    default:
      return '';
  }
}

/** True when MIME is allowed, or MIME is generic but extension matches allow-list. */
export function isAllowedChatDocument(mimeType: string | null | undefined, fileName: string | null | undefined): boolean {
  const ext = extensionFromFileName(fileName);
  const m = (mimeType || '').toLowerCase().split(';')[0].trim();

  if (m && ALLOWED_MIMES.has(m)) return true;
  if (ext && EXTENSION_TO_MIME.has(ext)) {
    if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return true;
    const expected = EXTENSION_TO_MIME.get(ext);
    if (expected && m === expected) return true;
  }
  return false;
}

export function resolveDocumentExtension(
  fileName: string | null | undefined,
  mimeType: string | null | undefined
): string {
  const fromName = extensionFromFileName(fileName);
  if (fromName) return fromName;
  const fromMime = guessExtensionFromMime(mimeType);
  if (fromMime) return fromMime;
  return 'bin';
}

export function formatFileSizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export function isDocumentLikeMime(mime: string | null | undefined): boolean {
  const m = (mime || '').toLowerCase();
  return (
    m.includes('pdf') ||
    m.startsWith('text/') ||
    m.includes('word') ||
    m.includes('excel') ||
    m.includes('spreadsheet') ||
    m.includes('powerpoint') ||
    m.includes('presentation') ||
    m === 'application/zip'
  );
}

export function isPdfDocument(mimeType: string | null | undefined, extension: string | null | undefined): boolean {
  const m = (mimeType || '').toLowerCase().split(';')[0].trim();
  const e = (extension || '').toLowerCase().replace(/^\./, '');
  return m === 'application/pdf' || e === 'pdf';
}
