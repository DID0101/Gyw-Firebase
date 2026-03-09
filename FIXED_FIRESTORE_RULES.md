# ✅ Fixed Firestore Security Rules

## The Problem
Your code uses `participants` but your rules check for `members`. Also, query rules need to be different from document rules.

## The Correct Rules

Copy and paste these into Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update, delete: if request.auth != null && request.auth.uid == userId;
    }
    
    // Chats collection
    match /chats/{chatId} {
      // Allow read if user is a participant
      // Note: For queries, Firestore checks this rule against each matching document
      allow read: if request.auth != null && 
        request.auth.uid in resource.data.participants;
      
      // Allow create if user is in participants array
      allow create: if request.auth != null && 
        request.auth.uid in request.resource.data.participants;
      
      // Allow update if user is a participant
      allow update: if request.auth != null && 
        request.auth.uid in resource.data.participants;
      
      // Messages subcollection
      match /messages/{messageId} {
        // For reading messages, check if user is in chat participants
        allow read: if request.auth != null && 
          request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants;
        
        // Allow create if user is the sender and is a chat participant
        allow create: if request.auth != null && 
          request.auth.uid == request.resource.data.senderId &&
          request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants;
        
        // Allow update/delete if user is the sender
        allow update, delete: if request.auth != null && 
          request.auth.uid == resource.data.senderId;
      }
    }
  }
}
```

## Key Changes

1. ✅ Changed `members` → `participants` (matches your code)
2. ✅ Fixed read rule to use `resource.data.participants` (correct for reads)
3. ✅ Messages rule checks chat participants correctly
4. ✅ All rules now match your actual data structure

## How to Apply

1. Go to: https://console.firebase.google.com/project/gyw2-7749e/firestore/rules
2. Replace all existing rules with the rules above
3. Click **"Publish"**
4. Restart your app

## Alternative: Simpler Rules (For Testing)

If you still have issues, use these simpler rules first to test:

```javascript
rules_version = '2';
service cloud.firestore {
   match /databases/{database}/documents {
     match /{document=**} {
       allow read, write: if request.auth != null;
     }
   }
}
```

This allows any authenticated user to read/write everything. Once it works, switch to the more secure rules above.

