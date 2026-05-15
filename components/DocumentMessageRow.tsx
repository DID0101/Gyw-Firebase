import { formatFileSizeBytes } from '@/lib/documents/documentUpload';
import type { MessageStatus } from '@/lib/types/chat';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Feather } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MessageStatusIndicator from './MessageStatusIndicator';

const SCREEN_W = Dimensions.get('window').width;
/** Card width: match bubble feel — fluid, capped (parent bubble supplies max width). */
const CARD_MAX = Math.min(SCREEN_W * 0.68, 300);

type DocKind = 'pdf' | 'word' | 'excel' | 'ppt' | 'txt' | 'zip' | 'generic';

function classifyDoc(mimeType: string | undefined, extension: string | undefined): DocKind {
  const e = (extension || '').toLowerCase().replace(/^\./, '');
  const m = (mimeType || '').toLowerCase();
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.includes('wordprocessing') || m === 'application/msword' || e === 'doc' || e === 'docx') return 'word';
  if (m.includes('spreadsheet') || m === 'application/vnd.ms-excel' || e === 'xls' || e === 'xlsx') return 'excel';
  if (m.includes('presentation') || m === 'application/vnd.ms-powerpoint' || e === 'ppt' || e === 'pptx') return 'ppt';
  if (m === 'text/plain' || e === 'txt') return 'txt';
  if (m === 'application/zip' || e === 'zip') return 'zip';
  return 'generic';
}

function docPalette(kind: DocKind): {
  accent: string;
  accentSoft: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
} {
  switch (kind) {
    case 'pdf':
      return {
        accent: '#E53935',
        accentSoft: 'rgba(229,57,53,0.14)',
        icon: 'file-pdf-box',
      };
    case 'word':
      return {
        accent: '#185ABD',
        accentSoft: 'rgba(24,90,189,0.14)',
        icon: 'file-word-box',
      };
    case 'excel':
      return {
        accent: '#1B7A3D',
        accentSoft: 'rgba(27,122,61,0.14)',
        icon: 'file-excel-box',
      };
    case 'ppt':
      return {
        accent: '#D24726',
        accentSoft: 'rgba(210,71,38,0.14)',
        icon: 'file-powerpoint-box',
      };
    case 'txt':
      return {
        accent: '#6B7280',
        accentSoft: 'rgba(107,114,128,0.16)',
        icon: 'file-document-outline',
      };
    case 'zip':
      return {
        accent: '#F57C00',
        accentSoft: 'rgba(245,124,0,0.14)',
        icon: 'folder-zip-outline',
      };
    default:
      return {
        accent: '#FF5722',
        accentSoft: 'rgba(255,87,34,0.14)',
        icon: 'file-document-outline',
      };
  }
}

function docShortLabel(kind: DocKind, t: (k: string) => string): string {
  switch (kind) {
    case 'pdf':
      return t('documents.shortPdf');
    case 'word':
      return t('documents.shortWord');
    case 'excel':
      return t('documents.shortExcel');
    case 'ppt':
      return t('documents.shortPpt');
    case 'txt':
      return t('documents.shortTxt');
    case 'zip':
      return t('documents.shortZip');
    default:
      return t('documents.shortFile');
  }
}

/** Extension badge text (DOCX, PDF, …) — prefer real extension when available. */
function extensionBadgeLabel(
  extension: string | undefined,
  kind: DocKind,
  shortLabel: string,
  t: (k: string) => string
): string {
  const e = (extension || '').toLowerCase().replace(/^\./, '');
  if (e && e.length <= 5 && /^[a-z0-9]+$/i.test(e)) return e.toUpperCase();
  if (kind === 'word' && !e) return t('documents.shortWord');
  if (kind === 'excel' && !e) return t('documents.shortExcel');
  if (kind === 'ppt' && !e) return t('documents.shortPpt');
  return shortLabel;
}

export interface DocumentMessageRowProps {
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  extension?: string;
  isMyMessage: boolean;
  isDark: boolean;
  onOpen: () => void;
  /** When true, time + ticks live inside the card (WhatsApp-style). */
  showEmbeddedFooter?: boolean;
  timeLabel?: string;
  messageStatus?: MessageStatus;
  isFailed?: boolean;
  onRetryPress?: () => void;
  edited?: boolean;
  /** Optimistic send: subtle spinner instead of chevron */
  isPending?: boolean;
}

function DocumentMessageRowInner({
  fileName,
  fileSize,
  mimeType,
  extension,
  isMyMessage,
  isDark,
  onOpen,
  showEmbeddedFooter,
  timeLabel,
  messageStatus,
  isFailed,
  onRetryPress,
  edited,
  isPending,
}: DocumentMessageRowProps) {
  const { t } = useTranslation();

  const kind = useMemo(() => classifyDoc(mimeType, extension), [mimeType, extension]);
  const palette = useMemo(() => docPalette(kind), [kind]);
  const shortLabel = useMemo(() => docShortLabel(kind, t), [kind, t]);
  const extBadge = useMemo(
    () => extensionBadgeLabel(extension, kind, shortLabel, t),
    [extension, kind, shortLabel, t]
  );

  const sizeLabel = useMemo(
    () => (typeof fileSize === 'number' && fileSize > 0 ? formatFileSizeBytes(fileSize) : null),
    [fileSize]
  );

  const name = fileName.trim() || t('messages.document');

  const cardBg = isMyMessage
    ? 'rgba(255,255,255,0.14)'
    : isDark
      ? 'rgba(255,255,255,0.07)'
      : '#f3f4f6';

  const nameColor = isMyMessage ? '#ffffff' : isDark ? '#f9fafb' : '#111827';
  const metaColor = isMyMessage ? 'rgba(255,255,255,0.72)' : isDark ? '#9ca3af' : '#6b7280';
  const footerMuted = isMyMessage ? 'rgba(255,255,255,0.55)' : isDark ? '#9ca3af' : '#6b7280';
  const footerBorder = isMyMessage ? 'rgba(255,255,255,0.22)' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const iconFg = '#ffffff';

  const accessibilityLabel = `${name}${sizeLabel ? `, ${sizeLabel}` : ''}, ${extBadge}. ${t('messages.openDocument')}`;

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={
        Platform.OS === 'android'
          ? { color: isMyMessage ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.08)' }
          : undefined
      }
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBg,
          maxWidth: CARD_MAX,
          opacity: pressed ? 0.92 : 1,
        },
        !isMyMessage && Platform.OS === 'android'
          ? { elevation: 1 }
          : null,
        !isMyMessage && Platform.OS === 'ios'
          ? {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: isDark ? 0.25 : 0.06,
              shadowRadius: 2,
            }
          : null,
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconBlock, { backgroundColor: palette.accent }]}>
          <MaterialCommunityIcons name={palette.icon} size={34} color={iconFg} />
          <View style={styles.extPill}>
            <Text style={styles.extPillText} numberOfLines={1}>
              {extBadge}
            </Text>
          </View>
        </View>

        <View style={styles.textColumn}>
          <Text
            style={[styles.fileName, { color: nameColor }]}
            numberOfLines={2}
            ellipsizeMode="middle"
          >
            {name}
          </Text>
          {sizeLabel ? (
            <Text style={[styles.sizeText, { color: metaColor }]} numberOfLines={1}>
              {sizeLabel}
            </Text>
          ) : (
            <Text style={[styles.sizePlaceholder, { color: metaColor }]} numberOfLines={1}>
              {' '}
            </Text>
          )}
        </View>

        <View style={styles.chevronWrap}>
          {isPending ? (
            <ActivityIndicator
              size="small"
              color={isMyMessage ? 'rgba(255,255,255,0.75)' : isDark ? '#9ca3af' : '#6b7280'}
            />
          ) : (
            <Feather
              name="chevron-right"
              size={20}
              color={isMyMessage ? 'rgba(255,255,255,0.5)' : isDark ? '#6b7280' : '#9ca3af'}
            />
          )}
        </View>
      </View>

      {showEmbeddedFooter && timeLabel ? (
        <View style={[styles.footerRow, { borderTopColor: footerBorder }]}>
          <View style={styles.footerLeft}>
            <View style={[styles.typeChip, { backgroundColor: palette.accentSoft }]}>
              <Text style={[styles.typeChipText, { color: palette.accent }]} numberOfLines={1}>
                {extBadge}
              </Text>
            </View>
            {edited ? (
              <Text style={[styles.editedHint, { color: footerMuted }]}>{t('messages.edited')}</Text>
            ) : null}
          </View>
          <View style={styles.footerRight}>
            <Text style={[styles.timeText, { color: footerMuted }]}>{timeLabel}</Text>
            {isMyMessage ? (
              isFailed && onRetryPress ? (
                <Pressable onPress={onRetryPress} hitSlop={8} accessibilityLabel={t('common.retry')}>
                  <Feather name="alert-circle" size={14} color="#fecaca" />
                </Pressable>
              ) : (
                <MessageStatusIndicator status={messageStatus || 'sent'} size={13} />
              )
            ) : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 4,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    minWidth: Math.min(220, SCREEN_W * 0.52),
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 10,
  },
  iconBlock: {
    width: 56,
    minHeight: 64,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  extPill: {
    marginTop: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.2)',
    maxWidth: 52,
  },
  extPillText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  fileName: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  sizeText: {
    fontSize: 12.5,
    marginTop: 4,
    fontWeight: '500',
  },
  sizePlaceholder: {
    fontSize: 12.5,
    marginTop: 4,
  },
  chevronWrap: {
    justifyContent: 'center',
    paddingLeft: 2,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  typeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: 88,
  },
  typeChipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  editedHint: {
    fontSize: 10,
    fontStyle: 'italic',
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});

function areEqual(prev: DocumentMessageRowProps, next: DocumentMessageRowProps): boolean {
  return (
    prev.fileName === next.fileName &&
    prev.fileSize === next.fileSize &&
    prev.mimeType === next.mimeType &&
    prev.extension === next.extension &&
    prev.isMyMessage === next.isMyMessage &&
    prev.isDark === next.isDark &&
    prev.showEmbeddedFooter === next.showEmbeddedFooter &&
    prev.timeLabel === next.timeLabel &&
    prev.messageStatus === next.messageStatus &&
    prev.isFailed === next.isFailed &&
    prev.edited === next.edited &&
    prev.isPending === next.isPending
  );
}

export const DocumentMessageRow = memo(DocumentMessageRowInner, areEqual);

DocumentMessageRow.displayName = 'DocumentMessageRow';
