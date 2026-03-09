# 🔧 Troubleshooting Firestore Permission Errors

## Step 1: Verify Your Rules Are Correct

Go to: https://console.firebase.google.com/project/gyw2-7749e/firestore/rules

**Make sure your rules use `participants` NOT `members`:**

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
      allow read: if request.auth != null && 
        request.auth.uid in resource.data.participants;
      allow create: if request.auth != null && 
        request.auth.uid in request.resource.data.participants;
      allow update: if request.auth != null && 
        request.auth.uid in resource.data.participants;
      
      match /messages/{messageId} {
        allow read: if request.auth != null && 
          request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.participants;
        allow create: if request.auth != null && 
          request.auth.uid == request.resource.data.senderId;
        allow update, delete: if request.auth != null && 
          request.auth.uid == resource.data.senderId;
      }
    }
  }
}
```

**Click "Publish" after making changes!**

---

## Step 2: Test with Simple Rules First

If the above doesn't work, temporarily use these **simple rules** to test:

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

**If this works**, then the issue is with your specific rules.  
**If this doesn't work**, then the issue is authentication or something else.

---

## Step 3: Check Authentication

Make sure you're actually signed in:

1. Check the app - are you on the chats screen or still on sign-in?
2. Check Firebase Console → Authentication → Users - do you see your user?
3. In your app logs, do you see any auth errors?

---

## Step 4: Check for Composite Index

If you're using `where` + `orderBy`, you might need a composite index.

1. Check your terminal/console for an error like:
   ```
   The query requires an index. You can create it here: [URL]
   ```
2. If you see that, click the URL to create the index automatically
3. Wait 2-3 minutes for the index to build

---

## Step 5: Verify Data Structure

Make sure your chat documents actually have a `participants` field:

1. Go to Firebase Console → Firestore Database → Data
2. Check if you have any documents in the `chats` collection
3. If you do, open one and verify it has a `participants` field (array of user IDs)

---

## Step 6: Clear Cache and Restart

1. Stop your app (Ctrl+C)
2. Clear Metro cache: `npx expo start --clear`
3. Restart: `npx expo run:android`

---

## Still Not Working?

If none of the above works, try this **debug version** of the rules that logs more info:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /chats/{chatId} {
      // More permissive read rule for debugging
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      
      match /messages/{messageId} {
        allow read, write: if request.auth != null;
      }
    }
    
    match /users/{userId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

This will help us determine if it's a rules issue or something else.

