import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { getDb } from "./adminApp";

export type RemoveGroupMemberPayload = { chatId?: unknown; targetUserId?: unknown };

/**
 * Atomically removes a member from a group, writes audit fields, and inserts a system message.
 * Only callable; clients cannot change `participants` directly (see Firestore rules).
 */
export async function handleRemoveGroupMember(
  data: RemoveGroupMemberPayload,
  context: functions.https.CallableContext
): Promise<{ ok: true }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  const chatId = typeof data.chatId === "string" ? data.chatId.trim() : "";
  const targetUserId = typeof data.targetUserId === "string" ? data.targetUserId.trim() : "";
  if (!chatId || !targetUserId) {
    throw new functions.https.HttpsError("invalid-argument", "chatId and targetUserId are required");
  }
  const actorUid = context.auth.uid;
  if (targetUserId === actorUid) {
    throw new functions.https.HttpsError("invalid-argument", "Cannot remove yourself with this action");
  }

  const db = getDb();
  const chatRef = db.collection("chats").doc(chatId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(chatRef);
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Chat not found");
    }
    const c = snap.data() as Record<string, unknown>;
    if (c.type !== "group") {
      throw new functions.https.HttpsError("failed-precondition", "Not a group chat");
    }
    const participants = Array.isArray(c.participants) ? (c.participants as string[]) : [];
    if (!participants.includes(actorUid)) {
      throw new functions.https.HttpsError("permission-denied", "Not a member of this group");
    }
    if (!participants.includes(targetUserId)) {
      throw new functions.https.HttpsError("failed-precondition", "User is not in this group");
    }

    const roles = c.participantRoles && typeof c.participantRoles === "object" ? (c.participantRoles as Record<string, string>) : null;
    const createdBy = typeof c.createdBy === "string" ? c.createdBy : null;
    const targetIsAdmin =
      roles?.[targetUserId] === "admin" ||
      (roles == null && createdBy == null && participants.length > 0 && participants[0] === targetUserId);
    if (targetIsAdmin) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot remove a group admin");
    }

    const isAdmin =
      roles?.[actorUid] === "admin" ||
      (createdBy != null && createdBy === actorUid) ||
      (roles == null && createdBy == null && participants.length > 0 && participants[0] === actorUid);

    if (!isAdmin) {
      throw new functions.https.HttpsError("permission-denied", "Only a group admin can remove members");
    }

    const newParticipants = participants.filter((id) => id !== targetUserId);
    if (newParticipants.length < 1) {
      throw new functions.https.HttpsError("failed-precondition", "Cannot remove the last member");
    }

    const pd = (c.participantData && typeof c.participantData === "object" ? c.participantData : {}) as Record<
      string,
      { name?: string }
    >;
    const actorName = pd[actorUid]?.name?.trim() || "Someone";
    const targetName = pd[targetUserId]?.name?.trim() || "Member";
    const systemText = `${actorName} removed ${targetName}`;

    const msgRef = chatRef.collection("messages").doc();

    const updatePayload: Record<string, unknown> = {
      participants: newParticipants,
      participantCount: newParticipants.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      [`participantData.${targetUserId}`]: admin.firestore.FieldValue.delete(),
      [`participantRoles.${targetUserId}`]: admin.firestore.FieldValue.delete(),
      [`unreadCount.${targetUserId}`]: admin.firestore.FieldValue.delete(),
      [`removedMembers.${targetUserId}`]: admin.firestore.FieldValue.serverTimestamp(),
    };

    tx.update(chatRef, updatePayload);

    tx.set(msgRef, {
      chatId,
      type: "system",
      systemKind: "member_removed",
      senderId: actorUid,
      senderName: actorName,
      text: systemText,
      systemActorId: actorUid,
      systemTargetId: targetUserId,
      systemActorName: actorName,
      systemTargetName: targetName,
      readBy: [actorUid],
      status: "sent",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
}
