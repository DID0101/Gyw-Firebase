/**
 * Video/audio accept pipeline tracing.
 * Filter device logs: ACCEPT_ | CALL_ACCEPT_ | CALL_SCREEN_ | WEBRTC_ | CALLEE_SNAPSHOT | CALLER_SNAPSHOT
 */

export function acceptFlowLog(
  stage: string,
  callId: string,
  detail?: Record<string, unknown>,
): void {
  console.log(stage, { callId, ts: Date.now(), ...detail });
}

export function acceptFlowLogCalleeSnapshot(
  callId: string,
  status: string,
  extra?: Record<string, unknown>,
): void {
  acceptFlowLog('CALLEE_SNAPSHOT_STATUS', callId, { status, ...extra });
}

export function acceptFlowLogCallerSnapshot(
  callId: string,
  status: string,
  extra?: Record<string, unknown>,
): void {
  acceptFlowLog('CALLER_SNAPSHOT_STATUS', callId, { status, ...extra });
}
