# Firestore Security Rules - Updated for Reactions

## Updated Rules (Include Reaction Support)

Copy and paste these updated rules into your Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read/write access to all users for now (for development)
    match /{document=**} {
      allow read, write: if request.auth != null;
    }

    // Users collection
    match /users/{userId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId;
      allow delete: if false;
    }

    // Chats collection
    match /chats/{chatId} {
      allow read, write: if request.auth != null && (
        resource.data.participants.hasAny([request.auth.uid]) ||
        (request.auth.uid == resource.data.callerId && resource.data.type == 'call') ||
        (request.auth.uid == resource.data.receiverId && resource.data.type == 'call')
      );

      // Messages subcollection
      match /messages/{messageId} {
        allow read: if request.auth != null && (
          get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
          (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.callerId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call') ||
          (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.receiverId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call')
        );
        
        // Allow create if user is a participant
        allow create: if request.auth != null && (
          get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
          (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.callerId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call') ||
          (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.receiverId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call')
        ) && request.resource.data.senderId == request.auth.uid;
        
        // Allow update for:
        // 1. Message sender (can update their own messages)
        // 2. Any participant (can update reactions field only)
        allow update: if request.auth != null && (
          // User is a participant in the chat
          get(/databases/$(database)/documents/chats/$(chatId)).data.participants.hasAny([request.auth.uid]) ||
          (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.callerId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call') ||
          (request.auth.uid == get(/databases/$(database)/documents/chats/$(chatId)).data.receiverId && get(/databases/$(database)/documents/chats/$(chatId)).data.type == 'call')
        ) && (
          // Either: user is the sender (can update anything)
          resource.data.senderId == request.auth.uid ||
          // Or: user is updating only reactions and updatedAt fields
          (
            request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions', 'updatedAt']) &&
            request.resource.data.senderId == resource.data.senderId &&
            request.resource.data.text == resource.data.text &&
            request.resource.data.type == resource.data.type
          )
        );
        
        allow delete: if request.auth != null && resource.data.senderId == request.auth.uid;
      }
    }

    // Calls collection
    match /calls/{callId} {
      allow read, write: if request.auth != null && (
        request.auth.uid == resource.data.callerId ||
        request.auth.uid == resource.data.receiverId
      );
    }

    // Call Signaling subcollection
    match /callSignaling/{callId}/messages/{messageId} {
      allow read, write: if request.auth != null && (
        request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.callerId ||
        request.auth.uid == get(/databases/$(database)/documents/calls/$(callId)).data.receiverId
      );
    }

    // Stories collection
    match /stories/{storyId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == resource.data.userId;
      allow update: if false;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }
  }
}
```

## Key Changes for Reactions

The updated rules allow **any participant** in a chat to update the `reactions` field on messages, not just the message sender. The update rule checks:

1. User is a participant in the chat
2. Either:
   - User is the sender (can update anything)
   - OR user is only updating `reactions` and `updatedAt` fields (and not changing other message content)

## How to Apply

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Go to **Firestore Database** → **Rules** tab
4. Replace the existing rules with the rules above
5. Click **Publish**

After publishing, reaction updates should work without permission errors!

