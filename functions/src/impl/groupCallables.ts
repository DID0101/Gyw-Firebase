import * as admin from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import { getDb } from "./adminApp";

const MAX_NAME = 120;
const MAX_DESC = 2000;
const MAX_GROUP = 256;
const MAX_ADD_BATCH = 25;

function isAdminOf(
  c: Record<string, unknown>,
  uid: string,
  participants: string[]
): boolean {
  const roles = c.participantRoles as Record<string, string> | undefined;
  const createdBy = typeof c.createdBy === "string" ? c.createdBy : "";
  if (roles?.[uid] === "admin") return true;
  if (createdBy && createdBy === uid) return true;
  if (!roles && !createdBy && participants.length > 0 && participants[0] === uid) return true;
  return false;
}

async function userParticipantMeta(
  db: Firestore,
  uid: string
): Promise<{ name: string; avatar?: string; username?: string }> {
  const snap = await db.collection("users").doc(uid).get();
  const u = snap.data() || {};
  const name =
    `${String(u.firstName || "").trim()} ${String(u.lastName || "").trim()}`.trim() ||
    String(u.displayName || u.name || "").trim() ||
    "User";
  const meta: { name: string; avatar?: string; username?: string } = { name };
  if (typeof u.avatar === "string" && u.avatar) meta.avatar = u.avatar;
  if (typeof u.username === "string" && u.username) meta.username = u.username;
  return meta;
}

/** Create group + participantData + first system message (Admin SDK; clients cannot write `type: system`). */
export async function handleCreateGroup(
  data: { name?: unknown; description?: unknown; participantIds?: unknown },
  context: functions.https.CallableContext
): Promise<{ ok: true; chatId: string }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  const creatorId = context.auth.uid;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const rawIds = Array.isArray(data.participantIds) ? data.participantIds : [];
  const participantIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))].filter((id) => id !== creatorId);

  if (!name) {
    throw new functions.https.HttpsError("invalid-argument", "Group name is required");
  }
  if (name.length > MAX_NAME) {
    throw new functions.https.HttpsError("invalid-argument", "Group name is too long");
  }
  if (description.length > MAX_DESC) {
    throw new functions.https.HttpsError("invalid-argument", "Description is too long");
  }
  if (participantIds.length < 1) {
    throw new functions.https.HttpsError("invalid-argument", "Select at least one member besides yourself");
  }
  if (participantIds.length + 1 > MAX_GROUP) {
    throw new functions.https.HttpsError("invalid-argument", "Too many members");
  }

  const db = getDb();
  const allParticipants = [creatorId, ...participantIds];

  const participantData: Record<string, { name: string; avatar?: string; username?: string }> = {};
  for (const uid of allParticipants) {
    participantData[uid] = await userParticipantMeta(db, uid);
  }

  const creatorName = participantData[creatorId]?.name || "Someone";
  const participantRoles: Record<string, "admin" | "member"> = {};
  for (const id of allParticipants) {
    participantRoles[id] = id === creatorId ? "admin" : "member";
  }

  const unreadCount: Record<string, number> = {};
  for (const id of allParticipants) unreadCount[id] = 0;

  const chatRef = db.collection("chats").doc();
  const msgRef = chatRef.collection("messages").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const systemText = `${creatorName} created the group “${name.slice(0, 80)}${name.length > 80 ? "…" : ""}”`;

  const batch = db.batch();
  batch.set(chatRef, {
    type: "group",
    participants: allParticipants,
    participantData,
    participantRoles,
    createdBy: creatorId,
    name,
    ...(description ? { description } : {}),
    removedMembers: {},
    participantCount: allParticipants.length,
    unreadCount,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    lastMessage: {
      text: systemText,
      senderId: creatorId,
      createdAt: new Date().toISOString(),
      type: "system",
    },
    lastSenderId: creatorId,
  });

  batch.set(msgRef, {
    chatId: chatRef.id,
    type: "system",
    systemKind: "group_created",
    senderId: creatorId,
    senderName: creatorName,
    text: systemText,
    systemActorId: creatorId,
    systemActorName: creatorName,
    readBy: [creatorId],
    status: "sent",
    sentAt: new Date().toISOString(),
    createdAt: now,
  });

  await batch.commit();
  return { ok: true, chatId: chatRef.id };
}

export async function handleLeaveGroup(
  data: { chatId?: unknown },
  context: functions.https.CallableContext
): Promise<{ ok: true }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  const uid = context.auth.uid;
  const chatId = typeof data.chatId === "string" ? data.chatId.trim() : "";
  if (!chatId) {
    throw new functions.https.HttpsError("invalid-argument", "chatId is required");
  }

  const db = getDb();
  const chatRef = db.collection("chats").doc(chatId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Chat not found");
    const c = snap.data() as Record<string, unknown>;
    if (c.type !== "group") throw new functions.https.HttpsError("failed-precondition", "Not a group chat");
    const participants = Array.isArray(c.participants) ? (c.participants as string[]) : [];
    if (!participants.includes(uid)) {
      throw new functions.https.HttpsError("failed-precondition", "You are not in this group");
    }

    const newParticipants = participants.filter((id) => id !== uid);
    if (newParticipants.length < 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot leave an empty group");
    }

    const pd = (c.participantData || {}) as Record<string, { name?: string }>;
    const leaverName = pd[uid]?.name?.trim() || "Someone";
    const roles = { ...((c.participantRoles || {}) as Record<string, string>) };
    delete roles[uid];

    const wasAdmin = isAdminOf(c, uid, participants);
    const adminCount = newParticipants.filter((id) => roles[id] === "admin").length;
    if (wasAdmin && adminCount === 0 && newParticipants.length > 0) {
      roles[newParticipants[0]] = "admin";
    }

    const msgRef = chatRef.collection("messages").doc();
    const systemText = `${leaverName} left`;
    const nowIso = new Date().toISOString();

    tx.update(chatRef, {
      participants: newParticipants,
      participantRoles: roles,
      [`participantData.${uid}`]: admin.firestore.FieldValue.delete(),
      [`unreadCount.${uid}`]: admin.firestore.FieldValue.delete(),
      [`removedMembers.${uid}`]: admin.firestore.FieldValue.serverTimestamp(),
      participantCount: newParticipants.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: {
        text: systemText,
        senderId: uid,
        createdAt: nowIso,
        type: "system",
      },
      lastSenderId: uid,
    } as Record<string, unknown>);

    tx.set(msgRef, {
      chatId,
      type: "system",
      systemKind: "member_left",
      senderId: uid,
      senderName: leaverName,
      text: systemText,
      systemActorId: uid,
      systemActorName: leaverName,
      readBy: [uid],
      status: "sent",
      sentAt: nowIso,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
}

export async function handleAddGroupMembers(
  data: { chatId?: unknown; newMemberIds?: unknown },
  context: functions.https.CallableContext
): Promise<{ ok: true; added: string[] }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  const actorUid = context.auth.uid;
  const chatId = typeof data.chatId === "string" ? data.chatId.trim() : "";
  const raw = Array.isArray(data.newMemberIds) ? data.newMemberIds : [];
  const newMemberIds = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].filter((id) => id !== actorUid);

  if (!chatId || newMemberIds.length < 1) {
    throw new functions.https.HttpsError("invalid-argument", "chatId and newMemberIds are required");
  }
  if (newMemberIds.length > MAX_ADD_BATCH) {
    throw new functions.https.HttpsError("invalid-argument", "Too many users in one request");
  }

  const db = getDb();
  const chatRef = db.collection("chats").doc(chatId);

  const added = await db.runTransaction(async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Chat not found");
    const c = snap.data() as Record<string, unknown>;
    if (c.type !== "group") throw new functions.https.HttpsError("failed-precondition", "Not a group chat");
    const participants = Array.isArray(c.participants) ? (c.participants as string[]) : [];
    if (!participants.includes(actorUid)) {
      throw new functions.https.HttpsError("permission-denied", "Not a member");
    }
    if (!isAdminOf(c, actorUid, participants)) {
      throw new functions.https.HttpsError("permission-denied", "Only admins can add members");
    }

    const toAdd = newMemberIds.filter((id) => !participants.includes(id));
    if (toAdd.length === 0) return [];

    if (participants.length + toAdd.length > MAX_GROUP) {
      throw new functions.https.HttpsError("failed-precondition", "Group would exceed member limit");
    }

    const pd = { ...((c.participantData || {}) as Record<string, { name: string; avatar?: string; username?: string }>) };
    const roles = { ...((c.participantRoles || {}) as Record<string, "admin" | "member">) };
    const unread = { ...((c.unreadCount || {}) as Record<string, number>) };

    const names: string[] = [];
    for (const id of toAdd) {
      const meta = await userParticipantMeta(db, id);
      pd[id] = meta;
      roles[id] = "member";
      unread[id] = 0;
      names.push(meta.name);
    }

    const nextParticipants = [...participants, ...toAdd];
    const actorName = pd[actorUid]?.name?.trim() || "Someone";
    const label = names.length === 1 ? names[0] : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
    const systemText = `${actorName} added ${label}`;
    const nowIso = new Date().toISOString();
    const msgRef = chatRef.collection("messages").doc();

    tx.update(chatRef, {
      participants: nextParticipants,
      participantData: pd,
      participantRoles: roles,
      unreadCount: unread,
      participantCount: nextParticipants.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: {
        text: systemText,
        senderId: actorUid,
        createdAt: nowIso,
        type: "system",
      },
      lastSenderId: actorUid,
    } as Record<string, unknown>);

    tx.set(msgRef, {
      chatId,
      type: "system",
      systemKind: "member_added",
      senderId: actorUid,
      senderName: actorName,
      text: systemText,
      systemActorId: actorUid,
      systemActorName: actorName,
      readBy: [actorUid],
      status: "sent",
      sentAt: nowIso,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return toAdd;
  });

  return { ok: true, added };
}

export async function handleUpdateGroupInfo(
  data: { chatId?: unknown; name?: unknown; description?: unknown; avatarUrl?: unknown },
  context: functions.https.CallableContext
): Promise<{ ok: true }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  const actorUid = context.auth.uid;
  const chatId = typeof data.chatId === "string" ? data.chatId.trim() : "";
  const name = typeof data.name === "string" ? data.name.trim() : undefined;
  const description = typeof data.description === "string" ? data.description.trim() : undefined;
  const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : undefined;

  if (!chatId) {
    throw new functions.https.HttpsError("invalid-argument", "chatId is required");
  }
  if (name === undefined && description === undefined && avatarUrl === undefined) {
    throw new functions.https.HttpsError("invalid-argument", "Nothing to update");
  }
  if (name != null && name.length > MAX_NAME) {
    throw new functions.https.HttpsError("invalid-argument", "Name too long");
  }
  if (description != null && description.length > MAX_DESC) {
    throw new functions.https.HttpsError("invalid-argument", "Description too long");
  }
  if (avatarUrl != null && avatarUrl.length > 2000) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid avatar URL");
  }
  if (avatarUrl != null && !/^https:\/\//i.test(avatarUrl)) {
    throw new functions.https.HttpsError("invalid-argument", "Avatar must be an https URL");
  }

  const db = getDb();
  const chatRef = db.collection("chats").doc(chatId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists) throw new functions.https.HttpsError("not-found", "Chat not found");
    const c = snap.data() as Record<string, unknown>;
    if (c.type !== "group") throw new functions.https.HttpsError("failed-precondition", "Not a group chat");
    const participants = Array.isArray(c.participants) ? (c.participants as string[]) : [];
    if (!participants.includes(actorUid)) {
      throw new functions.https.HttpsError("permission-denied", "Not a member");
    }
    if (!isAdminOf(c, actorUid, participants)) {
      throw new functions.https.HttpsError("permission-denied", "Only admins can edit group info");
    }

    const pd = (c.participantData || {}) as Record<string, { name?: string }>;
    const actorName = pd[actorUid]?.name?.trim() || "Someone";
    const patch: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (name !== undefined) patch.name = name;
    if (description !== undefined) {
      patch.description =
        description.length > 0 ? description : admin.firestore.FieldValue.delete();
    }
    if (avatarUrl !== undefined) {
      patch.avatar = avatarUrl.length > 0 ? avatarUrl : admin.firestore.FieldValue.delete();
    }

    const prevAvatar = typeof c.avatar === "string" ? c.avatar : "";
    const avatarChanged = avatarUrl != null && avatarUrl !== prevAvatar;

    const msgRef = chatRef.collection("messages").doc();
    const nowIso = new Date().toISOString();
    let systemText: string | null = null;
    let systemKind: string | null = null;
    if (avatarChanged) {
      systemText = `${actorName} changed the group photo`;
      systemKind = "group_avatar_changed";
    } else if (name !== undefined || description !== undefined) {
      systemText = `${actorName} updated group info`;
      systemKind = "group_info_updated";
    }

    if (systemText && systemKind) {
      patch.lastMessageAt = admin.firestore.FieldValue.serverTimestamp();
      patch.lastMessage = {
        text: systemText,
        senderId: actorUid,
        createdAt: nowIso,
        type: "system",
      };
      patch.lastSenderId = actorUid;
      tx.set(msgRef, {
        chatId,
        type: "system",
        systemKind,
        senderId: actorUid,
        senderName: actorName,
        text: systemText,
        systemActorId: actorUid,
        systemActorName: actorName,
        readBy: [actorUid],
        status: "sent",
        sentAt: nowIso,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    tx.update(chatRef, patch);
  });

  return { ok: true };
}
