# Add Production SHA-1 to Firebase

You created a new Android keystore via EAS. Add its SHA-1 to Firebase so phone auth works for **release builds** (EAS/Play Store).

## Production SHA-1 (from EAS keystore)

```
6C:5E:D3:63:1C:7B:94:C0:65:02:94:D3:B0:2D:36:B4:A2:47:29:5B
```

## Steps

1. **Open Firebase Console**  
   https://console.firebase.google.com/project/gyw1-146d7/settings/general

2. **Your apps** → find **com.gyw.chat** (Android).

3. **Add fingerprint**  
   - Click **"Add fingerprint"**  
   - Paste: `6C:5E:D3:63:1C:7B:94:C0:65:02:94:D3:B0:2D:36:B4:A2:47:29:5B`  
   - Click **Save**

4. **Wait 2–3 minutes** for Firebase to process.

5. **Download new google-services.json**  
   - Click **"Download google-services.json"**  
   - Replace the file in your **project root**  
   - Replace the file in **android/app/** (if you use local Android builds)

6. **Verify**  
   ```bash
   node check-google-services.js
   ```  
   You should see more than one OAuth client (debug + production).

## Summary

- **Debug SHA-1** (already in Firebase): for `npx expo run:android` / local dev.  
- **Production SHA-1** (add as above): for `eas build` and Play Store builds.

After adding the production SHA-1 and updating `google-services.json`, phone auth will work for both debug and release builds.
