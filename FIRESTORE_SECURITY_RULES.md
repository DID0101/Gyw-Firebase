# Firestore Security Rules Setup

## ⚠️ CRITICAL: Fix Permission Errors Now

You're seeing these errors:
- `Error setting up user: Missing or insufficient permissions`
- `Error fetching chats: Missing or insufficient permissions`

**This is because Firestore security rules are not configured yet.**

## Quick Fix (5 minutes)

### Step 1: Open Firebase Console
1. Go to: https://console.firebase.google.com
2. Select your project: **gyw2-7749e**

### Step 2: Open Firestore Rules
1. Click **"Firestore Database"** in the left sidebar
2. Click the **"Rules"** tab at the top

### Step 3: Copy & Paste These Rules

**For Development/Testing (Use this first to get it working):**

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

**Click "Publish"** - This will fix the errors immediately!

---

## Production Rules (Use after testing)

Once everything works, replace with these more secure rules:

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
      // Allow read if user is a member
      allow read: if request.auth != null && 
        request.auth.uid in resource.data.members;
      
      // Allow create if user is in members array
      allow create: if request.auth != null && 
        request.auth.uid in request.resource.data.members;
      
      // Allow update if user is a member
      allow update: if request.auth != null && 
        request.auth.uid in resource.data.members;
      
      // Messages subcollection
      match /messages/{messageId} {
        allow read: if request.auth != null && 
          request.auth.uid in get(/databases/$(database)/documents/chats/$(chatId)).data.members;
        allow create: if request.auth != null && 
          request.auth.uid == request.resource.data.senderId;
        allow update, delete: if request.auth != null && 
          request.auth.uid == resource.data.senderId;
      }
    }
  }
}
```

## Verify Rules Are Working

After publishing the rules:
1. Restart your app
2. Sign in with a test account
3. Try creating a chat or sending a message
4. The permission errors should be gone

## Need Help?

If you still see permission errors after setting up rules:
- Check that you're signed in (check Firebase Auth state)
- Verify the rules were published successfully
- Check the Firebase Console logs for specific rule violations

