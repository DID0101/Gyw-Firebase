# Deploy Firebase Cloud Functions

## Prerequisites

1. **Install dependencies:**
   ```powershell
   cd functions
   npm install
   ```

2. **Install Firebase CLI** (if not already installed):
   ```powershell
   npm install -g firebase-tools
   ```

3. **Login and select project:**
   ```powershell
   firebase login
   firebase use gyw1-146d7
   ```

## Build & Deploy

**From project root:**
```powershell
cd "C:\Users\dpurl\Desktop\signal-clone - Copy"
cd functions
npm run build
cd ..
firebase deploy --only functions
```

**If you get "Timeout after 10000"** (path has spaces), run:
```powershell
.\functions\deploy.ps1
```

## Troubleshooting

- **"firebase" not recognized**: `npm install -g firebase-tools`
- **"Cannot find module"**: Run `npm install` in the `functions` folder
- **Timeout during deploy**: Use `.\functions\deploy.ps1` or move project to path without spaces (e.g. `C:\Projects\signal-clone`)
