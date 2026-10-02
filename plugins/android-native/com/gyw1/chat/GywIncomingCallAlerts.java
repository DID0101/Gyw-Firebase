package com.gyw1.chat;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

/**
 * Plays custom app ringtone + repeating vibration for incoming calls.
 *
 * <p>Notification channels are silent — this class is the only ring/haptic source.
 */
public final class GywIncomingCallAlerts {
  private static final String TAG = "GywIncomingCallAlerts";
  private static final long[] VIBRATE_PATTERN_AUDIO = {0, 550, 180, 550, 180, 750, 280, 550};
  private static final long[] VIBRATE_PATTERN_VIDEO = {0, 200, 100, 200, 100, 400, 120, 280};
  private static final long AUTO_STOP_MS = 45_000L;

  private static final Handler mainHandler = new Handler(Looper.getMainLooper());
  private static Runnable autoStopTask;

  private static Ringtone activeRingtone;
  private static Vibrator activeVibrator;
  private static String activeCallId;
  private static long[] activeVibratePattern = VIBRATE_PATTERN_AUDIO;
  private static AudioManager activeAudioManager;
  private static AudioFocusRequest activeAudioFocusRequest;
  private static AudioManager.OnAudioFocusChangeListener focusChangeListener;

  private GywIncomingCallAlerts() {}

  public static Uri defaultRingtoneUri(Context context) {
    Uri uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE);
    if (uri == null) {
      uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    }
    return uri;
  }

  /** Custom {@code res/raw/ringtone.wav} — works in killed state via android.resource URI. */
  public static Uri appRingtoneUri(Context context) {
    if (context == null) return null;
    try {
      int resId =
          context.getResources().getIdentifier("ringtone", "raw", context.getPackageName());
      if (resId != 0) {
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + resId);
      }
    } catch (Exception e) {
      Log.w(TAG, "appRingtoneUri lookup failed: " + e.getMessage());
    }
    return null;
  }

  /** Starts ring + vibrate for {@code callId}. Idempotent if already ringing the same id. */
  public static synchronized void start(Context ctx, String callId) {
    start(ctx, callId, "audio");
  }

  public static synchronized void start(Context ctx, String callId, String callType) {
    if (callId == null || callId.isEmpty()) return;
    Context app = ctx.getApplicationContext();

    if (IncomingCallGuard.isAnswered(app, callId)) {
      Log.d(TAG, "RING_START blocked=answered callId=" + callId);
      return;
    }

    if (callId.equals(activeCallId) && activeRingtone != null) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && activeRingtone.isPlaying()) {
        return;
      }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
        return;
      }
    }

    if (activeCallId != null && !callId.equals(activeCallId)) {
      Log.w(TAG, "RING_RESTART prevCallId=" + activeCallId + " newCallId=" + callId);
    } else {
      Log.d(TAG, "RING_START callId=" + callId + " callType=" + callType);
    }
    stop(app);
    activeCallId = callId;
    activeVibratePattern =
        "video".equalsIgnoreCase(callType) ? VIBRATE_PATTERN_VIDEO : VIBRATE_PATTERN_AUDIO;

    startRingtone(app);
    startVibrate(app);

    if (autoStopTask != null) mainHandler.removeCallbacks(autoStopTask);
    final String stopId = callId;
    autoStopTask =
        () -> {
          synchronized (GywIncomingCallAlerts.class) {
            if (stopId.equals(activeCallId)) {
              stop(app);
            }
          }
        };
    mainHandler.postDelayed(autoStopTask, AUTO_STOP_MS);
  }

  public static synchronized void stop(Context ctx) {
    Log.d(TAG, "RING_STOP callId=" + activeCallId);
    Log.d(TAG, "CALL_CLEANUP start component=GywIncomingCallAlerts callId=" + activeCallId);
    Context app = ctx != null ? ctx.getApplicationContext() : null;
    if (autoStopTask != null) {
      mainHandler.removeCallbacks(autoStopTask);
      autoStopTask = null;
    }
    stopRingtone();
    stopVibrate(app);
    releaseAudioFocus();
    activeCallId = null;
    Log.d(TAG, "CALL_CLEANUP complete component=GywIncomingCallAlerts");
  }

  private static void startRingtone(Context app) {
    try {
      Uri uri = appRingtoneUri(app);
      if (uri == null) {
        uri = defaultRingtoneUri(app);
        Log.w(TAG, "Using system default ringtone (res/raw/ringtone missing)");
      } else {
        Log.d(TAG, "Using app ringtone: " + uri);
      }
      if (uri == null) {
        Log.w(TAG, "No ringtone URI");
        return;
      }

      Ringtone rt = RingtoneManager.getRingtone(app, uri);
      if (rt == null) return;

      requestAudioFocus(app);
      AudioAttributes aa =
          new AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        rt.setAudioAttributes(aa);
      } else {
        rt.setStreamType(AudioManager.STREAM_RING);
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        rt.setLooping(true);
      }
      rt.play();
      activeRingtone = rt;
      Log.d(TAG, "Ringtone playing");
      if (activeCallId != null) {
        CallLatencyTrace.mark(activeCallId, "RINGTONE_STARTED");
      }
    } catch (Exception e) {
      Log.w(TAG, "Ringtone failed: " + e.getMessage());
    }
  }

  private static void stopRingtone() {
    try {
      if (activeRingtone != null) {
        activeRingtone.stop();
        Log.d(TAG, "ringtone released");
      }
    } catch (Exception ignored) {
    } finally {
      activeRingtone = null;
    }
  }

  @SuppressWarnings("deprecation")
  private static void startVibrate(Context app) {
    try {
      Vibrator v = getVibrator(app);
      if (v == null || !v.hasVibrator()) return;
      activeVibrator = v;
      long[] pattern = activeVibratePattern;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        int n = pattern.length;
        int[] amps = new int[n];
        for (int i = 0; i < n; i++) {
          amps[i] = pattern[i] == 0 ? 0 : VibrationEffect.DEFAULT_AMPLITUDE;
        }
        VibrationEffect eff = VibrationEffect.createWaveform(pattern, amps, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          VibrationAttributes attrs =
              VibrationAttributes.createForUsage(VibrationAttributes.USAGE_RINGTONE);
          v.vibrate(eff, attrs);
        } else {
          v.vibrate(eff);
        }
      } else {
        v.vibrate(pattern, 0);
      }
      Log.d(TAG, "Vibrator started");
    } catch (Exception e) {
      Log.w(TAG, "Vibrate failed: " + e.getMessage());
    }
  }

  private static Vibrator getVibrator(Context app) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      VibratorManager vm =
          (VibratorManager) app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
      return vm != null ? vm.getDefaultVibrator() : null;
    }
    return (Vibrator) app.getSystemService(Context.VIBRATOR_SERVICE);
  }

  private static void stopVibrate(Context app) {
    try {
      Vibrator v = activeVibrator;
      if (v == null && app != null) v = getVibrator(app);
      if (v != null) {
        v.cancel();
        Log.d(TAG, "vibration cancelled");
      }
    } catch (Exception ignored) {
    } finally {
      activeVibrator = null;
    }
  }

  private static void requestAudioFocus(Context app) {
    try {
      AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
      if (am == null) return;
      activeAudioManager = am;
      if (focusChangeListener == null) {
        focusChangeListener = (focusChange) -> {};
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        AudioAttributes attrs =
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        activeAudioFocusRequest =
            new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusChangeListener)
                .build();
        am.requestAudioFocus(activeAudioFocusRequest);
      } else {
        am.requestAudioFocus(
            focusChangeListener,
            AudioManager.STREAM_RING,
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
      }
    } catch (Exception e) {
      Log.w(TAG, "requestAudioFocus failed: " + e.getMessage());
    }
  }

  private static void releaseAudioFocus() {
    try {
      if (activeAudioManager == null) return;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activeAudioFocusRequest != null) {
        activeAudioManager.abandonAudioFocusRequest(activeAudioFocusRequest);
      } else if (focusChangeListener != null) {
        activeAudioManager.abandonAudioFocus(focusChangeListener);
      }
      Log.d(TAG, "audio focus released");
    } catch (Exception e) {
      Log.w(TAG, "releaseAudioFocus failed: " + e.getMessage());
    } finally {
      activeAudioFocusRequest = null;
      activeAudioManager = null;
    }
  }
}
