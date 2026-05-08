package com.gyw1.chat;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Log;
import android.view.Display;
import androidx.core.content.ContextCompat;
import com.facebook.react.HeadlessJsTaskService;
import com.google.firebase.messaging.RemoteMessage;
import io.invertase.firebase.app.ReactNativeFirebaseApp;
import io.invertase.firebase.common.ReactNativeFirebaseEventEmitter;
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingHeadlessService;
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingSerializer;
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService;
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingStoreHelper;
import java.util.List;
import java.util.Map;

/**
 * Replaces RN Firebase's no-op {@link ReactNativeFirebaseMessagingService#onMessageReceived}.
 *
 * <p><b>Do not use {@code SharedUtils.isAppInForeground(getApplicationContext())}</b> here: when
 * the context is not a {@code ReactContext}, that helper catches {@code ClassCastException} and
 * returns {@code true}, which makes the app look "foreground" forever and breaks incoming-call
 * wake / full-screen routing.
 */
public class GywFirebaseMessagingService extends ReactNativeFirebaseMessagingService {
  private static final String TAG = "GywFirebaseMessagingService";

  @Override
  public void onMessageReceived(RemoteMessage remoteMessage) {
    Map<String, String> data = remoteMessage.getData();
    Log.d(
        TAG,
        "onMessageReceived msgId="
            + remoteMessage.getMessageId()
            + " hasData="
            + (data != null && !data.isEmpty())
            + " keys="
            + (data != null ? data.keySet().toString() : "null")
            + " hasNotificationPayload="
            + (remoteMessage.getNotification() != null));
    if (remoteMessage.getNotification() != null) {
      Log.w(
          TAG,
          "FCM message includes top-level notification payload — Android may show system UI and skip data-only handling");
    }

    if (data != null) {
      String type = data.get("type");
      if ("call_cancelled".equals(type) || "incoming_call_cancelled".equals(type) || "call_ended".equals(type)) {
        String callId = data.get("callId");
        Context appCtx = getApplicationContext();
        Log.d(TAG, "native dismiss incoming UI on cancel/end push: callId=" + callId + ", type=" + type);
        GywIncomingCallNotifier.stopRingingAndDismissUi(appCtx, callId);
        forwardDefaultRnFirebase(remoteMessage);
        return;
      }
    }

    if (data != null) {
      String type = data.get("type");
      if (!"call".equals(type) && !"incoming_call".equals(type)) {
        Log.d(TAG, "strict FCM: ignoring non-call payload type=" + type);
        return;
      }

      Context appCtx = getApplicationContext();
      boolean fullPresentation = shouldUseFullIncomingPresentation(appCtx);
      boolean jsLikelyActive = isOurProcessVisibleTier(appCtx);

      Log.d(
          TAG,
          "incoming_call — native full-screen flow, fullPresentation="
              + fullPresentation
              + ", jsLikelyActive="
              + jsLikelyActive
              + " (FirebaseMessagingService + fullScreenIntent)");

      Bundle pushBundle = bundleFromData(data);
      GywIncomingCallNotifier.clearIncomingCallUiBeforeRinging(appCtx);

      Intent svc =
          new Intent(appCtx, GywIncomingCallService.class)
              .putExtra(GywIncomingCallService.EXTRA_CALL_ID, pushBundle.getString("callId"))
              .putExtra(GywIncomingCallService.EXTRA_CALLER_NAME, pushBundle.getString("callerName"))
              .putExtra(GywIncomingCallService.EXTRA_CALL_TYPE, pushBundle.getString("callType"));
      try {
        Log.d(TAG, "starting foreground call service now");
        ContextCompat.startForegroundService(appCtx, svc);
      } catch (Exception e) {
        Log.e(TAG, "startForegroundService incoming call — fallback to notifier", e);
        GywIncomingCallNotifier.show(appCtx, pushBundle, true);
      }

      // Keep RN informed for state sync/navigation when app is alive.
      forwardDefaultRnFirebase(remoteMessage);
      return;
    }
  }

  /**
   * Full-screen wake path only when the device is asleep, screen is off, or the user is locked
   * out. When the user is on an unlocked, awake device (whether in our app or another app), use
   * heads-up only — JS handles in-app ringing; other apps should not be taken over.
   */
  @SuppressWarnings("deprecation")
  private static boolean shouldUseFullIncomingPresentation(Context ctx) {
    PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
    KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);

    boolean screenOff = pm != null && !pm.isScreenOn();
    boolean interactive = pm != null && pm.isInteractive();
    boolean keyguard = km != null && km.isKeyguardLocked();
    boolean deviceLocked =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && km != null && km.isDeviceLocked();
    boolean defaultDisplayOff = isDefaultDisplayOff(ctx);

    boolean useFull =
        screenOff || defaultDisplayOff || !interactive || keyguard || deviceLocked;
    Log.d(
        TAG,
        "fullPresentation detail: screenOff="
            + screenOff
            + " defaultDisplayOff="
            + defaultDisplayOff
            + " interactive="
            + interactive
            + " keyguard="
            + keyguard
            + " deviceLocked="
            + deviceLocked
            + " -> "
            + useFull);
    return useFull;
  }

  /** Extra guard when {@link PowerManager#isScreenOn()} misreports on some OEMs / foldables. */
  private static boolean isDefaultDisplayOff(Context ctx) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN_MR1) {
      return false;
    }
    try {
      DisplayManager dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
      if (dm == null) {
        return false;
      }
      Display d = dm.getDisplay(Display.DEFAULT_DISPLAY);
      if (d == null) {
        return false;
      }
      return d.getState() == Display.STATE_OFF;
    } catch (Exception e) {
      Log.w(TAG, "isDefaultDisplayOff: " + e.getMessage());
      return false;
    }
  }

  /**
   * Rough "React UI might be on screen" signal without a {@code ReactContext}. Treat {@code
   * IMPORTANCE_VISIBLE} and better as visible.
   */
  private static boolean isOurProcessVisibleTier(Context ctx) {
    int imp = myProcessImportance(ctx);
    return imp <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
  }

  private static int myProcessImportance(Context ctx) {
    ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null) {
      return 1000;
    }
    List<ActivityManager.RunningAppProcessInfo> list = am.getRunningAppProcesses();
    if (list == null) {
      return 1000;
    }
    final String pkg = ctx.getPackageName();
    for (ActivityManager.RunningAppProcessInfo p : list) {
      if (p != null && pkg.equals(p.processName)) {
        return p.importance;
      }
    }
    return 1000;
  }

  private void forwardDefaultRnFirebase(RemoteMessage remoteMessage) {
    if (ReactNativeFirebaseApp.getApplicationContext() == null) {
      ReactNativeFirebaseApp.setApplicationContext(getApplicationContext());
    }
    ReactNativeFirebaseEventEmitter emitter = ReactNativeFirebaseEventEmitter.getSharedInstance();

    if (remoteMessage.getNotification() != null) {
      try {
        ReactNativeFirebaseMessagingStoreHelper.getInstance()
            .getMessagingStore()
            .storeFirebaseMessage(remoteMessage);
      } catch (Throwable t) {
        Log.w(TAG, "storeFirebaseMessage", t);
      }
    }

    if (isOurProcessVisibleTier(getApplicationContext())) {
      emitter.sendEvent(
          ReactNativeFirebaseMessagingSerializer.remoteMessageToEvent(remoteMessage, false));
      return;
    }

    try {
      Intent backgroundIntent =
          new Intent(getApplicationContext(), ReactNativeFirebaseMessagingHeadlessService.class);
      backgroundIntent.putExtra("message", remoteMessage);
      ComponentName name = getApplicationContext().startService(backgroundIntent);
      if (name != null) {
        HeadlessJsTaskService.acquireWakeLockNow(getApplicationContext());
      }
    } catch (IllegalStateException ex) {
      Log.e(TAG, "Headless FCM — background data needs high priority", ex);
    }
  }

  private static Bundle bundleFromData(Map<String, String> data) {
    Bundle b = new Bundle();
    for (Map.Entry<String, String> e : data.entrySet()) {
      if (e.getKey() != null && e.getValue() != null) {
        b.putString(e.getKey(), e.getValue());
      }
    }
    return b;
  }

}
