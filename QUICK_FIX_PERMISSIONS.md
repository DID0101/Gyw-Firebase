# ⚡ QUICK FIX: Firestore Permission Errors

## The Problem
You're seeing: `Missing or insufficient permissions`

This happens because Firestore security rules are not configured yet.

## The Solution (2 minutes)

### Step 1: Open Firebase Console
**Direct link:** https://console.firebase.google.com/project/gyw2-7749e/firestore/rules

Or manually:
1. Go to https://console.firebase.google.com
2. Select project: **gyw2-7749e**
3. Click **"Firestore Database"** in left sidebar
4. Click **"Rules"** tab

### Step 2: Replace the Rules
You'll see something like this in the editor:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Replace it with this:**

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

### Step 3: Publish
1. Click the **"Publish"** button (top right)
2. Wait for confirmation: "Rules published successfully"

### Step 4: Restart Your App
- Stop the app (Ctrl+C in terminal)
- Restart: `npx expo run:android`

## ✅ Done!

The permission errors should be gone now.

---

## What These Rules Do

- `allow read, write: if request.auth != null` means:
  - ✅ Any authenticated (signed-in) user can read and write data
  - ❌ Unauthenticated users cannot access anything

**Note:** These are development rules. For production, use the more secure rules in `FIRESTORE_SECURITY_RULES.md`.

