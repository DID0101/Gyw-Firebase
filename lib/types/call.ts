/**
 * lib/types/call.ts
 *
 * Canonical TypeScript interfaces for the GYW call data model.
 *
 * Firestore collections covered
 * ─────────────────────────────
 *   calls/{callId}                           CallDoc
 *   users/{uid}/callHistory/{callId}         CallHistoryEntry
 *   userTokens/{uid}                         UserTokenDoc
 *   userTokens/{uid}/devices/{deviceId}      DeviceTokenDoc
 *   callSignaling/{callId}/messages/{msgId}  CallSignalingMessage
 *
 * State machine
 * ─────────────
 *   ringing ──┬──► accepted ──► connecting ──► active ──► ended
 *             ├──► missed   (callee no answer in timeout window)
 *             ├──► timeout  (explicit timeout marker on some paths)
 *             ├──► declined (callee rejects)
 *             ├──► busy     (callee in another call)
 *             └──► canceled (caller cancels before answer)
 */

import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

type Timestamp = FirebaseFirestoreTypes.Timestamp;

// ── State machine ─────────────────────────────────────────────────────────────

/**
 * Every reachable state in the call lifecycle.
 *
 * Non-terminal (listener must stay attached):
 *   ringing | accepted | connecting | active
 *
 * Terminal (listener can detach, callHistory entry is written):
 *   ended | missed | declined | canceled | timeout | busy
 */
export type CallStatus =
  | 'ringing'    // CF created doc; push sent; waiting for callee
  | 'accepted'   // callee accepted; media setup pending
  | 'answered'   // legacy alias kept for backward compatibility
  | 'connecting' // WebRTC offer/answer exchanged; ICE running
  | 'active'     // ICE connected; media flowing
  | 'ended'      // normal hang-up by either party  OR  caller cancelled
  | 'canceled'   // caller cancelled before answer (canonical pre-answer end)
  | 'timeout'    // ring timeout reached (server/client explicit timeout marker)
  | 'missed'     // callee never answered within ringTimeoutSecs (server-only write)
  | 'declined'   // callee explicitly rejected
  | 'rejected'   // legacy alias kept for backward compatibility
  | 'busy';      // callee already had an active call

/** States from which no further client transition is allowed. */
export type CallTerminalStatus =
  | 'ended'
  | 'missed'
  | 'declined'
  | 'canceled'
  | 'timeout'
  | 'rejected'
  | 'busy';

/** States that require an active Firestore listener. */
export type CallLiveStatus = Exclude<CallStatus, CallTerminalStatus>;

// ── calls/{callId} ───────────────────────────────────────────────────────────

/**
 * Firestore document: calls/{callId}
 *
 * Created by the `initiateCall` Cloud Function.
 * Each state transition APPENDS its own timestamp fields — previous
 * timestamps are never removed.  Only `status` and `updatedAt` change
 * at every transition; all identity fields are immutable after creation.
 *
 * Document ID  = roomId  = callId  (a client-generated UUID v4)
 */
export interface CallDoc {
  // ── Identity — IMMUTABLE after creation ───────────────────────────────────
  /** Same as document ID. */
  callId:          string;
  callerId:        string;
  calleeId:        string;
  callType:        'audio' | 'video';
  callerName:      string;
  calleeName:      string;
  /** Empty string when no avatar is set. Never undefined. */
  callerAvatar:    string;
  calleeAvatar:    string;
  /** Associated 1:1 chat for the call log message. Null for random calls. */
  chatId:          string | null;
  isRandom:        boolean;
  /** Seconds before ring timeout; default 60. */
  ringTimeoutSecs: number;

  // ── Mutable ───────────────────────────────────────────────────────────────
  status:    CallStatus;
  updatedAt: Timestamp;

  // ── Creation timestamps ───────────────────────────────────────────────────
  createdAt:   Timestamp;
  /** createdAt + ringTimeoutSecs.  `markStaleRingingCallsMissed` reads this. */
  expiresAt:   Timestamp;
  /** createdAt + 7 days.  Hard-delete cleanup reads this. */
  deleteAfter: Timestamp;

  // ── Transition: ringing → answered ───────────────────────────────────────
  answeredAt?:       Timestamp;
  /** Device ID that answered — used to cancel duplicate push on other devices. */
  answeredByDevice?: string;

  // ── Transition: answered → connecting ────────────────────────────────────
  connectingAt?: Timestamp;

  // ── Transition: connecting → active ──────────────────────────────────────
  activeAt?: Timestamp;

  // ── Terminal transitions ──────────────────────────────────────────────────
  endedAt?:      Timestamp;
  /** UID of the party that triggered the terminal transition. */
  endedBy?:      string;
  /** Wall-clock seconds from activeAt → endedAt. Null if the call never went active. */
  duration?:     number | null;
  missedReason?: 'ring_timeout' | 'server_ring_timeout';
}

// ── Document snapshots at each state transition ───────────────────────────────

/**
 * Minimum field set written when the call document is first created.
 * All optional fields (answeredAt, etc.) are absent.
 *
 * @example
 * // calls/uuid-001  (status: "ringing")
 * {
 *   callId:          "uuid-001",
 *   callerId:        "alice-uid",
 *   calleeId:        "bob-uid",
 *   callType:        "audio",
 *   callerName:      "Alice",
 *   calleeName:      "Bob",
 *   callerAvatar:    "https://…/alice.jpg",
 *   calleeAvatar:    "",
 *   chatId:          "chat-alice-bob",
 *   isRandom:        false,
 *   ringTimeoutSecs: 60,
 *   status:          "ringing",
 *   createdAt:       <serverTimestamp>,
 *   updatedAt:       <serverTimestamp>,
 *   expiresAt:       <now + 60s>,
 *   deleteAfter:     <now + 7days>,
 * }
 *
 * // After callee accepts — merged update:
 * {
 *   status:          "accepted",
 *   answeredAt:      <serverTimestamp>,
 *   answeredByDevice:"device-uuid",
 *   updatedAt:       <serverTimestamp>,
 * }
 *
 * // After WebRTC offer exchanged — merged update:
 * {
 *   status:       "connecting",
 *   connectingAt: <serverTimestamp>,
 *   updatedAt:    <serverTimestamp>,
 * }
 *
 * // After ICE connected — merged update:
 * {
 *   status:    "active",
 *   activeAt:  <serverTimestamp>,
 *   updatedAt: <serverTimestamp>,
 * }
 *
 * // After hang-up — merged update:
 * {
 *   status:    "ended",
 *   endedAt:   <serverTimestamp>,
 *   endedBy:   "alice-uid",
 *   duration:  125,
 *   updatedAt: <serverTimestamp>,
 * }
 *
 * // Missed (server-only) — merged update:
 * {
 *   status:       "missed",
 *   endedAt:      <serverTimestamp>,
 *   missedReason: "server_ring_timeout",
 *   updatedAt:    <serverTimestamp>,
 * }
 *
 * // Declined — merged update by callee:
 * {
 *   status:    "declined",
 *   endedAt:   <serverTimestamp>,
 *   endedBy:   "bob-uid",
 *   updatedAt: <serverTimestamp>,
 * }
 *
 * // Busy — merged update by callee:
 * {
 *   status:    "busy",
 *   endedAt:   <serverTimestamp>,
 *   updatedAt: <serverTimestamp>,
 * }
 */
export type CallDocSnapshot = CallDoc; // same shape; documented above for readability

// ── users/{uid}/callHistory/{callId} ─────────────────────────────────────────

/**
 * Firestore document: users/{uid}/callHistory/{callId}
 *
 * Written by the `onCallTerminal` Cloud Function trigger when a call doc
 * reaches a terminal state.  One entry is written per party per call.
 * Document ID equals callId for easy cross-referencing with calls/{callId}.
 *
 * Client access: read-only (owner only).  All writes via Admin SDK.
 */
export interface CallHistoryEntry {
  callId:    string;
  direction: 'incoming' | 'outgoing';
  callType:  'audio' | 'video';
  status:    CallTerminalStatus;

  peerId:     string;
  peerName:   string;
  /** Empty string when no avatar is set. */
  peerAvatar: string;

  /** Wall-clock time the call was initiated (= calls/{callId}.createdAt). */
  startedAt:  Timestamp;
  /** Null for missed / declined / busy / cancelled calls. */
  answeredAt: Timestamp | null;
  endedAt:    Timestamp;
  /** Null if the call never reached the active state. */
  duration:   number | null;

  chatId:   string | null;
  isRandom: boolean;
}

// ── userTokens/{uid} ─────────────────────────────────────────────────────────

/**
 * Firestore document: userTokens/{uid}
 *
 * Top-level single-device token record.  Kept for backwards compatibility.
 * Multi-device installations should also populate userTokens/{uid}/devices/{deviceId}.
 * The `initiateCall` CF reads the subcollection first and falls back to this doc.
 */
export interface UserTokenDoc {
  uid:       string;
  /** Primary FCM registration token.  Null when not available. */
  fcmToken:  string | null;
  /** iOS VoIP / PushKit token.  Null on Android. */
  voipToken: string | null;
  platform:  'ios' | 'android' | 'web';
  updatedAt: Timestamp;
}

/**
 * Firestore document: userTokens/{uid}/devices/{deviceId}
 *
 * Per-device token record.  deviceId is a stable UUID stored in AsyncStorage
 * (`gyw_device_id`).  Enables push to all enrolled devices and allows
 * token rotation hygiene (delete stale entries when `lastActiveAt` is old).
 */
export interface DeviceTokenDoc {
  deviceId:     string;
  platform:     'ios' | 'android';
  fcmToken:     string;
  voipToken:    string | null;   // iOS only
  appVersion:   string;
  osVersion:    string;
  deviceModel:  string;
  locale:       string;
  updatedAt:    Timestamp;
  lastActiveAt: Timestamp;
}

// ── callSignaling/{callId}/messages/{msgId} ───────────────────────────────────

/**
 * Firestore document: callSignaling/{callId}/messages/{messageId}
 *
 * Short-lived WebRTC signaling messages.  The entire callSignaling/{callId}
 * subcollection is deleted when the parent call reaches a terminal state.
 *
 * Listener strategy: orderBy('createdAt', 'asc') — new documents trigger
 * the snapshot handler; processed messages are NOT deleted to avoid
 * re-delivery.  The entire collection is purged on call end by CF.
 */
export interface CallSignalingMessage {
  from:       string;
  to:         string;
  type:       'offer' | 'answer' | 'ice-candidate' | 'hangup';
  sdp?:       RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  createdAt:  Timestamp;
}

// ── Real-time listener strategy (documented here for co-location) ─────────────

/**
 * LISTENER STRATEGY SUMMARY
 * ─────────────────────────
 *
 * calls/{callId}  ─── onSnapshot  ──────────────────────────────────────────
 *   WHO attaches:
 *     • Caller — immediately after `initiateCall` CF returns.
 *       Watches: ringing → answered | declined | busy | missed | ended
 *       Detaches: on any terminal status OR on local hang-up.
 *
 *     • Callee — immediately after incoming-call push is processed by
 *       handleRemoteMessage().  The hook also starts the listener so it
 *       catches a "caller cancelled" (ringing → ended) before the callee acts.
 *       Detaches: after callee answers or declines.
 *
 *   WHY onSnapshot (not polling):
 *     • Latency: cancel/answer must dismiss the incoming UI in < 1 second.
 *     • Cost: single persistent WebSocket vs N HTTP requests.
 *     • Doc is < 1 KB — every snapshot fires immediately.
 *
 * callSignaling/{callId}/messages  ─── onSnapshot ─────────────────────────
 *   WHO attaches: both parties when status transitions to `answered`.
 *   QUERY: orderBy('createdAt', 'asc')
 *   Detaches: when call ends (status → terminal).
 *
 * users/{uid}/callHistory  ─── getDocs (paginated reads, NO listener) ─────
 *   WHY no listener:
 *     • History is append-only and immutable after write.
 *     • Real-time freshness is not needed in a history list.
 *   QUERY: orderBy('startedAt', 'desc').limit(25)  [cursor pagination]
 *   Refresh: pull-to-refresh triggers a fresh getDocs from startAfter = null.
 *
 * userTokens/{uid}/devices  ─── write-only from client ────────────────────
 *   Client writes on registration/token-refresh; never reads back.
 *   CF reads via Admin SDK (bypasses rules).
 */
export type _ListenerStrategyDoc = never; // marker type — not used at runtime

// ── Legacy re-exports — preserves all existing import sites ──────────────────

/** @deprecated Use CallDoc */
export interface Call {
  id:               string;
  callerId:         string;
  /** @deprecated calleeId is the canonical field name */
  receiverId:       string;
  callerName?:      string;
  callerAvatar?:    string;
  type:             'audio' | 'video';
  status:           CallStatus;
  createdAt:        string;
  endedAt?:         string;
  duration?:        number;
  chatId?:          string;
  direction?:       'incoming' | 'outgoing';
  isRandom?:        boolean;
  receiverReady?:   boolean;
  receiverReadyAt?: unknown;
}

/** @deprecated Use CallSignalingMessage */
export interface CallSignaling {
  callId:     string;
  from:       string;
  to:         string;
  type:       'offer' | 'answer' | 'ice-candidate' | 'hangup';
  sdp?:       RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  timestamp:  string;
}

export interface CallData {
  id:         string;
  callerId:   string;
  receiverId: string;
  callerName: string;
  avatarUrl?: string;
  type:       'audio' | 'video';
  chatId?:    string;
  isRandom?:  boolean;
}

export interface CallActions {
  accept: () => Promise<void>;
  reject: () => Promise<void>;
  mute?:  () => void;
}
