package com.gyw1.chat

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import androidx.annotation.RequiresApi
import java.util.concurrent.ConcurrentHashMap

/**
 * CallConnectionService
 *
 * Self-managed ConnectionService: the app shows its own UI (IncomingCallActivity /
 * the React Native call screen) — the system phone app is NOT used as the UI.
 * TelecomManager still tracks the call so the OS knows a call is in progress
 * (blocks Do-Not-Disturb, routes audio, integrates with Bluetooth / car kits, etc.).
 *
 * Flow:
 *   FCM data arrives (INCOMING_CALL)
 *     → GywFirebaseMessagingService.onMessageReceived()
 *         → CallConnectionService.addIncomingCall()   [static helper]
 *             → TelecomManager.addNewIncomingCall()
 *                 → onCreateIncomingConnection()       [OS callback — this class]
 *                     → GywCallConnection.setRinging()
 *                     → GywIncomingCallService started for WakeLock + foreground notification
 *   User accepts (IncomingCallActivity)
 *     → GywCallConnection.setActive()
 *   User rejects / call ends
 *     → GywCallConnection.setDisconnected()
 *
 * PhoneAccount registration:
 *   Call registerPhoneAccount(context) once from your Application.onCreate().
 *   It is idempotent — safe to call on every launch.
 *
 * Permissions declared in AndroidManifest.xml:
 *   android.permission.MANAGE_OWN_CALLS              — required to call addNewIncomingCall
 *   android.permission.READ_PHONE_STATE              — needed by TelecomManager on some API levels
 *   The <service> element must declare:
 *     android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"
 *   so only the Telecom subsystem can bind to this service.
 */
@RequiresApi(Build.VERSION_CODES.M)
class CallConnectionService : ConnectionService() {

  companion object {
    private const val TAG = "GywCallConnectionSvc"

    /**
     * Stable ID for our PhoneAccount.
     * Keep this constant across versions — changing it orphans registered accounts.
     */
    const val PHONE_ACCOUNT_ID = "gyw_voip_calls"

    /**
     * Broadcast action sent when the callee accepts a call from the Connection layer.
     * Extras: EXTRA_CALL_ID, EXTRA_CALL_TYPE
     */
    const val ACTION_CALL_ANSWERED = "com.gyw1.chat.telecom.CALL_ANSWERED"

    /**
     * Broadcast action sent when the callee rejects or disconnects.
     * Extras: EXTRA_CALL_ID
     */
    const val ACTION_CALL_REJECTED = "com.gyw1.chat.telecom.CALL_REJECTED"

    const val EXTRA_CALL_ID   = "callId"
    const val EXTRA_CALL_TYPE = "callType"
    private val activeConnections = ConcurrentHashMap<String, GywCallConnection>()

    // ── PhoneAccount ──────────────────────────��───────────────────────────────

    fun phoneAccountHandle(context: Context): PhoneAccountHandle =
      PhoneAccountHandle(
        ComponentName(context, CallConnectionService::class.java),
        PHONE_ACCOUNT_ID
      )

    /**
     * Register (or re-register) the PhoneAccount with the OS.
     * Call once from Application.onCreate() — idempotent.
     *
     * CAPABILITY_SELF_MANAGED: the app manages its own incoming/outgoing call UI.
     * The system phone app is not invoked; we get Telecom's call-state management
     * without the system dialer taking over the screen.
     */
    fun registerPhoneAccount(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return   // self-managed requires O+
      try {
        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val handle         = phoneAccountHandle(context)

        val account = PhoneAccount.builder(handle, "GYW Calls")
          .setCapabilities(
            PhoneAccount.CAPABILITY_SELF_MANAGED or
            PhoneAccount.CAPABILITY_SUPPORTS_VIDEO_CALLING
          )
          .build()

        telecomManager.registerPhoneAccount(account)
        Log.d(TAG, "PhoneAccount registered: ${handle.id}")
      } catch (e: Exception) {
        // Non-fatal: foreground-only flow still works via GywIncomingCallService
        Log.w(TAG, "registerPhoneAccount failed: ${e.message}")
      }
    }

    /**
     * Ask Telecom to add a new incoming call.
     * Returns true if Telecom accepted the request (does NOT guarantee connection was created).
     * Returns false if Telecom is unavailable — caller should fall back to the
     * GywIncomingCallService / full-screen-intent path.
     *
     * @param context        Any context (application context preferred).
     * @param callId         Firestore call document ID.
     * @param callerName     Display name shown in the Connection entry.
     * @param callType       "audio" | "video"
     */
    fun addIncomingCall(
      context: Context,
      callId:     String,
      callerName: String,
      callType:   String
    ): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      return try {
        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val handle         = phoneAccountHandle(context)

        val extras = Bundle().apply {
          putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
          putString(EXTRA_CALL_ID,   callId)
          putString(EXTRA_CALL_TYPE, callType)
          // callerName carried as the Uri display name
          putParcelable(
            TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,
            Uri.fromParts("sip", callerName, null)
          )
          putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, Bundle().apply {
            putString(EXTRA_CALL_ID,   callId)
            putString(EXTRA_CALL_TYPE, callType)
            putString("callerName", callerName)
          })
        }

        telecomManager.addNewIncomingCall(handle, extras)
        Log.d(TAG, "addNewIncomingCall dispatched callId=$callId")
        true
      } catch (e: SecurityException) {
        Log.e(TAG, "addNewIncomingCall SecurityException — MANAGE_OWN_CALLS missing? ${e.message}")
        false
      } catch (e: Exception) {
        Log.e(TAG, "addNewIncomingCall failed: ${e.message}")
        false
      }
    }

    /**
     * Tell Telecom the call ended (if Telecom was managing it).
     * Paired with addIncomingCall — call this when the call screen closes.
     */
    fun reportCallEnded(context: Context, callId: String) {
      endCall(callId, DisconnectCause(DisconnectCause.LOCAL))
      // GywCallConnection holds the disconnect logic.
      // We notify via broadcast so the Connection object can call setDisconnected().
      context.sendBroadcast(
        android.content.Intent(ACTION_CALL_REJECTED).apply {
          setPackage(context.packageName)
          putExtra(EXTRA_CALL_ID, callId)
        }
      )
    }

    fun endCall(callId: String, cause: DisconnectCause = DisconnectCause(DisconnectCause.LOCAL)) {
      val c = activeConnections.remove(callId) ?: return
      try {
        c.disconnect(cause)
        Log.d(TAG, "CALL_CLEANUP telecom ended callId=$callId")
      } catch (e: Exception) {
        Log.w(TAG, "CALL_CLEANUP telecom end failed callId=$callId err=${e.message}")
      }
    }

    fun registerConnection(connection: GywCallConnection) {
      activeConnections[connection.callId] = connection
    }

    fun unregisterConnection(callId: String) {
      activeConnections.remove(callId)
    }
  }

  // ── ConnectionService overrides ───────────────────────────────���───────────

  @RequiresApi(Build.VERSION_CODES.M)
  override fun onCreateIncomingConnection(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest
  ): Connection {
    val extras   = request.extras ?: Bundle()
    val callId   = extras.getString(EXTRA_CALL_ID, "unknown")
    val callType = extras.getString(EXTRA_CALL_TYPE, "audio")

    Log.d(TAG, "onCreateIncomingConnection callId=$callId type=$callType")

    val connection = GywCallConnection(
      appContext  = applicationContext,
      callId      = callId,
      callType    = callType
    )

    connection.setCallerDisplayName(
      extras.getString("callerName", "Incoming call"),
      TelecomManager.PRESENTATION_ALLOWED
    )
    connection.setAddress(
      request.address ?: Uri.EMPTY,
      TelecomManager.PRESENTATION_ALLOWED
    )
    connection.setVideoState(
      if (callType == "video") android.telecom.VideoProfile.STATE_BIDIRECTIONAL
      else android.telecom.VideoProfile.STATE_AUDIO_ONLY
    )

    // Move to RINGING — this is what the OS needs to know before showing any UI
    connection.setRinging()
    registerConnection(connection)

    return connection
  }

  override fun onCreateIncomingConnectionFailed(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest
  ) {
    val callId = request.extras?.getString(EXTRA_CALL_ID, "") ?: ""
    Log.w(TAG, "onCreateIncomingConnectionFailed callId=$callId — Telecom rejected the call")
    // The FCM service will have already started GywIncomingCallService as a fallback,
    // so the user will still see the incoming call UI.
  }
}

// ── GywCallConnection ──────────────────────────��──────────────────────��───────

/**
 * Represents a single incoming call within the Telecom framework.
 *
 * State machine:
 *   RINGING → ACTIVE   (user answers via IncomingCallActivity or Bluetooth)
 *   RINGING → DISCONNECTED  (user rejects, remote hangs up, timeout)
 *   ACTIVE  → DISCONNECTED  (call ends)
 */
@RequiresApi(Build.VERSION_CODES.M)
class GywCallConnection(
  private val appContext: Context,
  val callId:             String,
  val callType:           String
) : Connection() {

  private val TAG = "GywCallConnection"

  init {
    // PROPERTY_SELF_MANAGED mirrors PhoneAccount.CAPABILITY_SELF_MANAGED.
    // Required for the OS to know we manage our own UI.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      connectionProperties = PROPERTY_SELF_MANAGED
    }
    audioModeIsVoip = true
    connectionCapabilities =
      CAPABILITY_MUTE or CAPABILITY_SUPPORT_HOLD or CAPABILITY_HOLD
  }

  // ── User answered (from IncomingCallActivity Accept button or Bluetooth) ──

  override fun onAnswer() = onAnswer(android.telecom.VideoProfile.STATE_AUDIO_ONLY)

  override fun onAnswer(videoState: Int) {
    Log.d(TAG, "onAnswer callId=$callId videoState=$videoState")
    setActive()
    IncomingCallActionHandler.accept(appContext, callId, callType, "telecom", true)
    // IncomingCallActivity already handled navigation; broadcast for any remaining listeners.
    appContext.sendBroadcast(
      android.content.Intent(CallConnectionService.ACTION_CALL_ANSWERED).apply {
        setPackage(appContext.packageName)
        putExtra(CallConnectionService.EXTRA_CALL_ID,   callId)
        putExtra(CallConnectionService.EXTRA_CALL_TYPE, callType)
      }
    )
  }

  // ── User rejected (from IncomingCallActivity Decline or lock-screen) ──────

  override fun onReject() {
    Log.d(TAG, "onReject callId=$callId")
    IncomingCallActionHandler.decline(appContext, callId, callType, "telecom", false)
    disconnect(DisconnectCause(DisconnectCause.REJECTED))
    appContext.sendBroadcast(
      android.content.Intent(CallConnectionService.ACTION_CALL_REJECTED).apply {
        setPackage(appContext.packageName)
        putExtra(CallConnectionService.EXTRA_CALL_ID, callId)
      }
    )
  }

  // ── Call ended (remote hung up, timeout, or app-level disconnect) ─────────

  override fun onDisconnect() {
    Log.d(TAG, "onDisconnect callId=$callId")
    disconnect(DisconnectCause(DisconnectCause.REMOTE))
  }

  override fun onAbort() {
    Log.d(TAG, "onAbort callId=$callId")
    disconnect(DisconnectCause(DisconnectCause.CANCELED))
  }

  /** Convenience: set state + destroy. Does nothing if already disconnected. */
  fun disconnect(cause: DisconnectCause) {
    if (state == STATE_DISCONNECTED) return
    setDisconnected(cause)
    destroy()
    CallConnectionService.unregisterConnection(callId)
    GywIncomingCallNotifier.stopRingingAndDismissUi(appContext, callId)
    IncomingCallActionHandler.releaseTerminalLock(callId, "connection_disconnected")
  }
}
