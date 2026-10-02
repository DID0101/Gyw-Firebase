package com.gyw1.chat;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.Nullable;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/** Native Firestore terminal-state writes for killed-state notification actions. */
public final class NativeCallStateUpdater {
  private static final String TAG = "NativeCallStateUpdater";
  private static final long AUTH_WAIT_MS = 3500L;

  private NativeCallStateUpdater() {}

  public static void updateTerminalState(
      Context context, String callId, String status, @Nullable Runnable onFinished) {
    if (callId == null || callId.isEmpty()) {
      finish(onFinished);
      return;
    }

  // Note: IncomingCallActionHandler passes "accepted"; Firestore rules require "answered".
    String normalized =
        "accepted".equals(status) || "answered".equals(status) ? "answered" : "declined";
    FirebaseFirestore db = FirebaseFirestore.getInstance();
    FirebaseAuth auth = FirebaseAuth.getInstance();
    FirebaseUser user = auth.getCurrentUser();

    Log.d(
        TAG,
        "BACKEND_TERMINAL_UPDATE start callId="
            + callId
            + " status="
            + normalized
            + ("declined".equals(normalized) ? " CALLEE_DECLINE_START" : ""));

    if (user != null) {
      readAndUpdate(db, callId, normalized, user.getUid(), onFinished);
      return;
    }

    Log.w(TAG, "BACKEND_TERMINAL_UPDATE waiting_for_auth callId=" + callId);
    final Handler handler = new Handler(Looper.getMainLooper());
    final AtomicBoolean started = new AtomicBoolean(false);

    FirebaseAuth.AuthStateListener listener =
        new FirebaseAuth.AuthStateListener() {
          @Override
          public void onAuthStateChanged(FirebaseAuth firebaseAuth) {
            FirebaseUser restored = firebaseAuth.getCurrentUser();
            if (restored != null && started.compareAndSet(false, true)) {
              firebaseAuth.removeAuthStateListener(this);
              handler.removeCallbacksAndMessages(null);
              readAndUpdate(db, callId, normalized, restored.getUid(), onFinished);
            }
          }
        };

    auth.addAuthStateListener(listener);
    handler.postDelayed(
        () -> {
          if (started.compareAndSet(false, true)) {
            auth.removeAuthStateListener(listener);
            Log.e(
                TAG,
                "BACKEND_TERMINAL_UPDATE auth_timeout callId="
                    + callId
                    + " status="
                    + normalized);
            finish(onFinished);
          }
        },
        AUTH_WAIT_MS);
  }

  private static void readAndUpdate(
      FirebaseFirestore db,
      String callId,
      String status,
      String uid,
      @Nullable Runnable onFinished) {
    db.collection("calls")
        .document(callId)
        .get()
        .addOnSuccessListener(snapshot -> updateIfCallee(db, snapshot, callId, status, uid, onFinished))
        .addOnFailureListener(
            error -> {
              Log.e(
                  TAG,
                  "BACKEND_TERMINAL_UPDATE read_failed callId="
                      + callId
                      + " status="
                      + status
                      + " error="
                      + error.getMessage());
              finish(onFinished);
            });
  }

  private static void updateIfCallee(
      FirebaseFirestore db,
      DocumentSnapshot snapshot,
      String callId,
      String status,
      @Nullable String uid,
      @Nullable Runnable onFinished) {
    if (!snapshot.exists()) {
      Log.w(TAG, "BACKEND_TERMINAL_UPDATE missing_call callId=" + callId);
      finish(onFinished);
      return;
    }

    Object receiverId = snapshot.get("receiverId");
    Object calleeId = snapshot.get("calleeId");
    String callee = receiverId instanceof String ? (String) receiverId : null;
    if ((callee == null || callee.isEmpty()) && calleeId instanceof String) {
      callee = (String) calleeId;
    }

    String currentStatus = snapshot.getString("status");
    if (currentStatus != null
        && !"ringing".equals(currentStatus)
        && !"accepted".equals(currentStatus)) {
      Log.w(
          TAG,
          "BACKEND_TERMINAL_UPDATE skip_non_ringing callId="
              + callId
              + " status="
              + currentStatus);
      finish(onFinished);
      return;
    }

    if (uid == null || callee == null || !uid.equals(callee)) {
      Log.w(
          TAG,
          "BACKEND_TERMINAL_UPDATE skip_not_callee callId="
              + callId
              + " uid="
              + uid
              + " calleeId="
              + callee);
      finish(onFinished);
      return;
    }

    Map<String, Object> update = new HashMap<>();
    update.put("status", status);
    update.put("updatedAt", FieldValue.serverTimestamp());
    if ("answered".equals(status)) {
      if (snapshot.get("answeredAt") == null) {
        update.put("answeredAt", FieldValue.serverTimestamp());
      }
    } else {
      update.put("endedAt", FieldValue.serverTimestamp());
    }

    db.collection("calls")
        .document(callId)
        .update(update)
        .addOnCompleteListener(
            task -> {
              if (task.isSuccessful()) {
                Log.d(
                    TAG,
                    "BACKEND_TERMINAL_UPDATE success callId="
                        + callId
                        + " status="
                        + status);
                if ("answered".equals(status)) {
                  Log.w(TAG, "ACCEPT_FIRESTORE_UPDATE_SUCCESS callId=" + callId + " status=answered");
                  Log.w(TAG, "CALL_DB_ACCEPT_WRITE_SUCCESS callId=" + callId + " status=answered");
                  Log.w(TAG, "CALL_STATUS_UPDATE_ACCEPTED callId=" + callId);
                  Log.w(TAG, "CALLER_RECEIVED_ACCEPTED callId=" + callId);
                } else if ("declined".equals(status)) {
                  Log.d(TAG, "handleDecline: Firestore write OK");
                } else {
                  Log.d(TAG, "CALL_DB_UPDATE_" + status.toUpperCase() + " callId=" + callId);
                }
                Log.w(TAG, "CALLER_RING_STOP callId=" + callId + " status=" + status);
              } else {
                Exception error = task.getException();
                if ("answered".equals(status)) {
                  Log.e(
                      TAG,
                      "ACCEPT_FIRESTORE_UPDATE_FAILED callId="
                          + callId
                          + " error="
                          + (error != null ? error.getMessage() : "unknown"));
                  Log.e(
                      TAG,
                      "CALL_DB_ACCEPT_WRITE_FAILED callId="
                          + callId
                          + " error="
                          + (error != null ? error.getMessage() : "unknown"));
                }
                Log.e(
                    TAG,
                    "BACKEND_TERMINAL_UPDATE failed callId="
                        + callId
                        + " status="
                        + status
                        + " error="
                        + (error != null ? error.getMessage() : "unknown"));
                if ("declined".equals(status)) {
                  Log.e(
                      TAG,
                      "handleDecline: Firestore write FAILED: "
                          + (error != null ? error.getMessage() : "unknown"));
                }
              }
              finish(onFinished);
            });
  }

  private static void finish(@Nullable Runnable onFinished) {
    if (onFinished == null) return;
    try {
      onFinished.run();
    } catch (Exception e) {
      Log.w(TAG, "finish callback failed: " + e.getMessage());
    }
  }
}
