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

    fun phoneAccountId(): String =
      if (IncomingCallPathConfig.useManagedTelecomTest()) {
        IncomingCallPathConfig.MANAGED_PHONE_ACCOUNT_ID
      } else {
        PHONE_ACCOUNT_ID
      }

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
    const val EXTRA_CALLER_UID = "callerUid"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_CALLER_AVATAR = "callerAvatar"
    private val activeConnections = ConcurrentHashMap<String, GywCallConnection>()

    // ── PhoneAccount ──────────────────────────��───────────────────────────────

    fun phoneAccountHandle(context: Context): PhoneAccountHandle =
      PhoneAccountHandle(
        ComponentName(context, CallConnectionService::class.java),
        phoneAccountId()
      )

    fun managedPhoneAccountHandle(context: Context): PhoneAccountHandle =
      PhoneAccountHandle(
        ComponentName(context, CallConnectionService::class.java),
        IncomingCallPathConfig.MANAGED_PHONE_ACCOUNT_ID
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
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      try {
        val telecomManager = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager

        if (IncomingCallPathConfig.useManagedTelecomTest()) {
          val managedHandle = managedPhoneAccountHandle(context)
          val managedAccount = PhoneAccount.builder(managedHandle, "GYW Calls Managed Test")
            .setCapabilities(PhoneAccount.CAPABILITY_SUPPORTS_VIDEO_CALLING)
            .build()
          telecomManager.registerPhoneAccount(managedAccount)
          Log.w(TAG, "MANAGED_TELECOM_TEST=true PHONE_ACCOUNT_REGISTERED id=${managedHandle.id}")
          Log.w(TAG, "SELF_MANAGED_CALL_ENABLED=false — observe SYSTEM incoming call UI")
          IncomingCallPathConfig.logPhoneAccountAudit(context, TAG)
          return
        }

        val handle = phoneAccountHandle(context)
        val account = PhoneAccount.builder(handle, "GYW Calls")
          .setCapabilities(
            PhoneAccount.CAPABILITY_SELF_MANAGED or
            PhoneAccount.CAPABILITY_SUPPORTS_VIDEO_CALLING
          )
          .build()

        telecomManager.registerPhoneAccount(account)
        Log.d(TAG, "PHONE_ACCOUNT_REGISTERED id=${handle.id}")
        Log.d(TAG, "SELF_MANAGED_CALL_ENABLED=true capabilities=SELF_MANAGED|VIDEO")
        IncomingCallPathConfig.logPhoneAccountAudit(context, TAG)
      } catch (e: Exception) {
        Log.w(TAG, "PHONE_ACCOUNT_REGISTER_FAILED: ${e.message}")
      }
    }

    /** True when our self-managed PhoneAccount is registered with Telecom. */
    fun isPhoneAccountRegistered(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      return try {
        val tm = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val handle = phoneAccountHandle(context)
        val accounts = tm.callCapablePhoneAccounts ?: emptyList()
        accounts.any { it.id == handle.id }
      } catch (e: Exception) {
        Log.w(TAG, "isPhoneAccountRegistered check failed: ${e.message}")
        false
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
      callType:   String,
      callerAvatar: String? = null,
      callerUid:  String? = null,
    ): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      if (IncomingCallGuard.isAnswered(context, callId)) {
        Log.d(TAG, "TELECOM_ADD_INCOMING_CALL blocked=answered callId=$callId")
        return false
      }
      Log.d(TAG, "TELECOM_ADD_INCOMING_CALL callId=$callId callType=$callType")
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
            putString(EXTRA_CALLER_NAME, callerName)
            putString(EXTRA_CALLER_AVATAR, callerAvatar ?: "")
            putString(EXTRA_CALLER_UID, callerUid ?: "")
            putString("callerName", callerName)
            putString("callerAvatar", callerAvatar ?: "")
            putString("callerUid", callerUid ?: "")
          })
        }

        Log.d(
          TAG,
          "CALL_PAYLOAD callId=$callId callerName=$callerName callerAvatar=${callerAvatar ?: ""} callerUid=${callerUid ?: ""}",
        )

        GywCallConnection.onShowIncomingCallUiFired = false
        GywCallConnection.onShowIncomingCallUiFiredAtMs = 0L
        telecomManager.addNewIncomingCall(handle, extras)
        Log.d(TAG, "TELECOM_CALL_ADDED callId=$callId callType=$callType managedTest=${IncomingCallPathConfig.useManagedTelecomTest()}")
        Log.d(TAG, "addNewIncomingCall dispatched — awaiting onCreateIncomingConnection + onShowIncomingCallUi")
        true
      } catch (e: SecurityException) {
        Log.e(TAG, "TELECOM_CALL_ADD_FAILED SecurityException MANAGE_OWN_CALLS? ${e.message}")
        false
      } catch (e: Exception) {
        Log.e(TAG, "TELECOM_CALL_ADD_FAILED: ${e.message}")
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

    /** Mark Telecom connection active after callee accepts (do not disconnect on accept). */
    fun answerIncomingCall(context: Context, callId: String) {
      val connection = activeConnections[callId]
      if (connection == null) {
        Log.w(TAG, "TELECOM_ANSWER_NO_CONNECTION callId=$callId")
        return
      }
      try {
        connection.setActive()
        Log.w(TAG, "TELECOM_CONNECTION_SET_ACTIVE callId=$callId")
      } catch (e: Exception) {
        Log.e(TAG, "TELECOM_CONNECTION_SET_ACTIVE failed callId=$callId err=${e.message}")
      }
    }

    internal fun parseIncomingConnectionExtras(request: ConnectionRequest): IncomingCallPayload {
      val top = request.extras ?: Bundle()
      val nested = top.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS) ?: Bundle()

      fun pick(key: String, altKey: String? = null): String {
        val fromNested = nested.getString(key)?.trim().orEmpty()
        if (fromNested.isNotEmpty()) return fromNested
        val fromTop = top.getString(key)?.trim().orEmpty()
        if (fromTop.isNotEmpty()) return fromTop
        if (altKey != null) {
          val altNested = nested.getString(altKey)?.trim().orEmpty()
          if (altNested.isNotEmpty()) return altNested
          val altTop = top.getString(altKey)?.trim().orEmpty()
          if (altTop.isNotEmpty()) return altTop
        }
        return ""
      }

      val rawName = pick(EXTRA_CALLER_NAME, "callerName")
      val callId = pick(EXTRA_CALL_ID).ifBlank { "unknown" }
      val callType = pick(EXTRA_CALL_TYPE, "callType").ifBlank { "audio" }
      val callerAvatar = pick(EXTRA_CALLER_AVATAR, "callerAvatar")
      val callerUid = pick(EXTRA_CALLER_UID, "callerUid")
      val callerPhone = pick("callerPhone", "caller_phone")

      var callerName =
          IncomingCallMetadata.resolveDisplayName(callerUid, callerPhone, rawName)
      if (callerName == "Unknown Caller" && rawName.isBlank()) {
        val addr = request.address
        val fromAddr = addr?.schemeSpecificPart?.trim().orEmpty()
        if (fromAddr.isNotBlank() && !fromAddr.equals("Incoming call", ignoreCase = true)) {
          callerName = fromAddr
        }
      }

      android.util.Log.w(
          TAG,
          "CALLER_META_TELECOM callId=$callId name=$callerName uid=$callerUid",
      )

      return IncomingCallPayload(callId, callType, callerName, callerAvatar, callerUid)
    }
  }

  data class IncomingCallPayload(
    val callId: String,
    val callType: String,
    val callerName: String,
    val callerAvatar: String,
    val callerUid: String,
  )

  // ── ConnectionService overrides ───────────────────────────────���───────────

  @RequiresApi(Build.VERSION_CODES.M)
  override fun onCreateIncomingConnection(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest
  ): Connection {
    val payload = Companion.parseIncomingConnectionExtras(request)
    val callId = payload.callId
    val callType = payload.callType
    val callerName = payload.callerName
    val callerAvatar = payload.callerAvatar
    val callerUid = payload.callerUid

    Log.d(TAG, "CONNECTION_SERVICE_STARTED callId=$callId type=$callType caller=$callerName")
    Log.w(
      TAG,
      "CALL_PAYLOAD callId=$callId callerName=$callerName callerAvatar=$callerAvatar callerUid=$callerUid",
    )

    val connection = GywCallConnection(
      appContext  = applicationContext,
      callId      = callId,
      callType    = callType,
      callerName  = callerName,
      callerAvatar = callerAvatar.ifBlank { null },
      callerUid   = callerUid.ifBlank { null },
      selfManaged = !IncomingCallPathConfig.useManagedTelecomTest(),
    )

    connection.setCallerDisplayName(
      callerName,
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
  val callType:           String,
  val callerName:         String = "Incoming call",
  val callerAvatar:       String? = null,
  val callerUid:          String? = null,
  private val selfManaged: Boolean = true,
) : Connection() {

  private val TAG = "GywCallConnection"

  companion object {
    @JvmField @Volatile var onShowIncomingCallUiFired: Boolean = false
    @JvmField @Volatile var onShowIncomingCallUiFiredAtMs: Long = 0L
  }

  init {
    if (selfManaged && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      connectionProperties = PROPERTY_SELF_MANAGED
    }
    audioModeIsVoip = true
    connectionCapabilities =
      CAPABILITY_MUTE or CAPABILITY_SUPPORT_HOLD or CAPABILITY_HOLD
  }

  /**
   * Telecom callback on the Connection (not ConnectionService): show self-managed incoming UI.
   * Authoritative killed/lockscreen path — replaces notification full-screen hacks.
   */
  override fun onShowIncomingCallUi() {
    onShowIncomingCallUiFired = true
    onShowIncomingCallUiFiredAtMs = System.currentTimeMillis()

    Log.w(TAG, "ON_SHOW_UI_ENTER callId=$callId selfManaged=$selfManaged")
    Log.w(TAG, "ON_SHOW_UI_THREAD=${Thread.currentThread().name}")
    Log.w(TAG, "ON_SHOW_UI_PROCESS=${android.os.Process.myPid()}")

    IncomingCallDiagnostics.logDeviceLockState(appContext, TAG)
    IncomingCallPathConfig.logActiveMode(TAG)
    IncomingCallPathConfig.logPhoneAccountAudit(appContext, TAG)

    if (IncomingCallPathConfig.useManagedTelecomTest()) {
      Log.w(
        TAG,
        "MANAGED_TELECOM_TEST=true — NOT launching IncomingCallActivity; " +
          "if system call UI appears, FINAL_BLOCKER=C_SELF_MANAGED_RESTRICTED_ON_OEM",
      )
      GywIncomingCallAlerts.start(appContext, callId, callType)
      return
    }

    if (IncomingCallPathConfig.SYSTEM_UI_ONLY_TEST) {
      Log.w(
        TAG,
        "SYSTEM_UI_ONLY_TEST=true — NOT launching IncomingCallActivity; " +
          "observe whether OEM shows any system call surface",
      )
      GywIncomingCallAlerts.start(appContext, callId, callType)
      return
    }

    GywIncomingCallAlerts.start(appContext, callId, callType)
    IncomingCallProcessState.logIncomingUxContext(appContext, TAG)

    GywIncomingCallNotifier.postPremiumIncomingCallNotification(
      appContext,
      callId,
      callerName,
      callerAvatar,
      callType,
    )

    Log.w(
      TAG,
      "CALL_PAYLOAD callId=$callId callerName=$callerName callerAvatar=${callerAvatar ?: ""} callerUid=${callerUid ?: ""}",
    )

    Log.w(TAG, "FULLSCREEN_ATTEMPTED=true source=telecom_onShowIncomingCallUi callId=$callId")
    val launched =
      IncomingCallUiLauncher.launchDirect(
        appContext,
        callId,
        callerName,
        callerAvatar,
        callType,
        "telecom_connection_onShowIncomingCallUi",
        callerUid,
      )
    Log.w(TAG, "ON_SHOW_UI_START_ACTIVITY_CALLED launched=$launched callId=$callId")
    IncomingCallUiLauncher.logFullscreenAttemptResult(appContext, callId, launched, 500L)
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
