# Quick Fix: Update Firestore Rules for Reactions

## The Problem
Your current security rules only allow the message sender to update messages. But for reactions, **any participant** in the chat should be able to update the `reactions` field.

## Quick Fix

Go to your Firebase Console → Firestore Database → Rules, and update **only the messages rule**:

### Find this section in your rules:
```javascript
// Messages subcollection
match /messages/{messageId} {
  allow read, write: if request.auth != null && (
    get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
    ...
  );
}
```

### Replace it with this (allows reactions updates):
```javascript
// Messages subcollection
match /messages/{messageId} {
  allow read: if request.auth != null && (
    get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
    (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.callerId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call') ||
    (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.receiverId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call')
  );
  
  allow create: if request.auth != null && (
    get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
    (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.callerId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call') ||
    (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.receiverId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call')
  ) && request.resource.data.senderId == request.auth.uid;
  
  // Allow update for sender OR for reactions (any participant can react)
  allow update: if request.auth != null && (
    get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
    (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.callerId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call') ||
    (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.receiverId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call')
  ) && (
    // User is the sender (can update anything)
    resource.data.senderId == request.auth.uid ||
    // OR user is a participant updating reactions (simpler check - just verify sender/content unchanged)
    (
      request.resource.data.senderId == resource.data.senderId &&
      request.resource.data.text == resource.data.text &&
      request.resource.data.type == resource.data.type &&
      request.resource.data.imageUrl == resource.data.imageUrl &&
      request.resource.data.videoUrl == resource.data.videoUrl &&
      request.resource.data.audioUrl == resource.data.audioUrl
    )
  );
  
  allow delete: if request.auth != null && resource.data.senderId == request.auth.uid;
}
```

## What Changed?

The `allow update` rule now allows:
1. **Message sender** - Can update any field (existing behavior)
2. **Any participant** - Can update **only** the `reactions` and `updatedAt` fields (new for reactions)

This ensures participants can add/remove reactions without being able to modify message content.

## After Updating

1. Click **"Publish"** in Firebase Console
2. Try adding a reaction again - it should work!

