/**
 * Design tokens and types for incoming call screens (audio + video).
 * Pure constants — no React Native or Expo imports.
 */

// ── Colors ────────────────────────────────────────────────────────────────────

export const CALL_COLORS = {
  /** WhatsApp-style dark teal for voice incoming screens */
  audioBackground: '#0a1628',

  /** Dark scrim over remote preview in video incoming mode */
  videoDimOverlay: 'rgba(0, 0, 0, 0.55)',

  /** Primary accept action */
  acceptGreen: '#34C759',
  acceptGreenRipple: 'rgba(52, 199, 89, 0.35)',

  /** Primary decline / end action */
  declineRed: '#FF3B30',
  declineRedRipple: 'rgba(255, 59, 48, 0.35)',

  /** Secondary “message” / remind-me pill */
  messagePillBackground: 'rgba(255, 255, 255, 0.12)',
  messagePillText: 'rgba(255, 255, 255, 0.92)',

  callerNameText: '#ffffff',
  /** Subtitle: “Incoming audio call”, etc. */
  callTypeText: 'rgba(255, 255, 255, 0.7)',

  /** Animated avatar ripple rings */
  rippleBase: 'rgba(255, 255, 255, 0.15)',
} as const;

// ── Layout constants ──────────────────────────────────────────────────────────

/** Accept / decline primary action diameter (px) */
export const ACTION_BUTTON_LARGE = 72;

/** Message, remind-me, and other secondary actions (px) */
export const ACTION_BUTTON_SMALL = 56;

/** Three concentric ripple ring diameters (px), inner → outer */
export const RIPPLE_SIZES = [100, 140, 180] as const;

/** Caller avatar diameter on incoming screens (px) */
export const AVATAR_SIZE = 96;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Config for a single circular call action button */
export type CallActionConfig = {
  /** Icon name (e.g. MaterialIcons / Ionicons glyph id) */
  icon: string;
  label: string;
  color: string;
  rippleColor: string;
  onPress: () => void;
  size?: 'large' | 'small';
};

/** Payload passed into incoming call UI layers */
export type IncomingCallData = {
  callId: string;
  callType: 'audio' | 'video';
  caller: {
    uid: string;
    displayName: string;
    photoURL?: string;
  };
  ringtoneUri?: string;
  timestamp: number;
};
