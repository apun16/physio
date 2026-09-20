/** Rehab Guardian — technical reliability types. Not clinical or diagnostic. */

export type GuardianPhase =
  | "pre_game"
  | "connecting"
  | "healthy"
  | "degraded"
  | "failure_detected"
  | "awaiting_user"
  | "recovering"
  | "fallback_active"
  | "recovered"
  | "unresolved"
  | "ended";

export type FailureType =
  | "web_serial_unsupported"
  | "port_open_failed"
  | "unexpected_disconnect"
  | "read_loop_failure"
  | "stale_stream"
  | "persistent_malformed"
  | "invalid_values"
  | "frozen_readings"
  | "unrealistic_jump"
  | "command_write_failed"
  | "command_ack_timeout"
  | "fallback_failed"
  | "sidekick_failure"
  | "recovery_unresolved";

export type RecoveryMethod =
  | "wait_for_frames"
  | "reconnect"
  | "calibrate"
  | "hand_cam_fallback"
  | "pause_and_exit";

export type RecoveryResult = "success" | "unresolved" | "suppressed";

export type DiagnosisChoice =
  | "controls_stopped"
  | "wrong_direction"
  | "intentionally_still"
  | "not_sure";

export type ConfirmationChoice = "works_now" | "still_wrong";

export type PromptKind = "none" | "intentional_disconnect" | "stillness" | "diagnosis" | "recovery" | "confirm";

export type GuardianSource = "real" | "simulated";
export type GuardianInputMode = "imu" | "hand";

export type SensorReliabilityKind =
  | "connecting"
  | "connected"
  | "first_valid_frame"
  | "malformed_frame"
  | "invalid_values"
  | "frozen_readings"
  | "unrealistic_jump"
  | "command_write_failed"
  | "command_sent"
  | "firmware_ack"
  | "command_ack_timeout"
  | "read_loop_failure"
  | "unexpected_disconnect"
  | "intentionally_disconnected"
  | "port_open_failed"
  | "port_picker_cancelled"
  | "unsupported";

export type SensorReliabilityEvent = {
  kind: SensorReliabilityKind;
  at: number;
};

export type GuardianEvent =
  | { type: "session_start"; at?: number }
  | { type: "dismiss_greeting" }
  | { type: "set_input_mode"; mode: GuardianInputMode }
  | { type: "set_source"; source: GuardianSource }
  | { type: "connecting"; at?: number }
  | { type: "connected"; at?: number }
  | { type: "first_valid_frame"; at?: number }
  | { type: "malformed_frame"; at?: number }
  | { type: "invalid_values"; at?: number }
  | { type: "frozen_readings"; at?: number }
  | { type: "unrealistic_jump"; at?: number }
  | { type: "stream_stale"; msSinceLastValid: number; at?: number }
  | { type: "port_open_failed"; at?: number }
  | { type: "port_picker_cancelled"; at?: number }
  | { type: "unsupported"; at?: number }
  | { type: "command_write_failed"; at?: number }
  | { type: "command_ack_timeout"; at?: number }
  | { type: "read_loop_failure"; at?: number }
  | { type: "unexpected_disconnect"; at?: number }
  | { type: "intentionally_disconnected"; at?: number }
  | { type: "prompt_user" }
  | { type: "user_intent"; intentional: boolean }
  | { type: "user_diagnosis"; choice: DiagnosisChoice }
  | { type: "start_recovery"; method: RecoveryMethod }
  | { type: "frames_stable" }
  | { type: "fallback_failed" }
  | { type: "recovery_unresolved" }
  | { type: "user_confirms"; choice: ConfirmationChoice }
  | { type: "session_end" };

export type GuardianState = {
  phase: GuardianPhase;
  source: GuardianSource;
  inputMode: GuardianInputMode;
  failureType: FailureType | null;
  recoveryMethod: RecoveryMethod | null;
  recoveryResult: RecoveryResult | null;
  incidentId: string | null;
  malformedCount: number;
  malformedWindowStart: number | null;
  invalidCount: number;
  invalidWindowStart: number | null;
  msSinceLastValid: number | null;
  diagnosis: DiagnosisChoice | null;
  confirmation: ConfirmationChoice | null;
  promptKind: PromptKind;
  sentryDeferred: boolean;
  greetingActive: boolean;
  lastEventAt: number;
};

export const MALFORMED_THRESHOLD = 8;
export const MALFORMED_WINDOW_MS = 4000;

export const INITIAL_GUARDIAN_STATE: GuardianState = {
  phase: "pre_game",
  source: "real",
  inputMode: "imu",
  failureType: null,
  recoveryMethod: null,
  recoveryResult: null,
  incidentId: null,
  malformedCount: 0,
  malformedWindowStart: null,
  invalidCount: 0,
  invalidWindowStart: null,
  msSinceLastValid: null,
  diagnosis: null,
  confirmation: null,
  promptKind: "none",
  sentryDeferred: false,
  greetingActive: false,
  lastEventAt: 0
};

export type SanitizedIncident = {
  incidentId: string;
  failureType: FailureType;
  game: "racing";
  component: "imu";
  inputMode: GuardianInputMode;
  source: GuardianSource;
  firmwarePacket: "five-field";
  msSinceLastValid: number | null;
  malformedCount: number;
  recoveryMethod: RecoveryMethod | null;
  recoveryResult: RecoveryResult | null;
  diagnosis: DiagnosisChoice | null;
  confirmation: ConfirmationChoice | null;
  appVersion: string;
  environment: string;
};

export function newIncidentId(now = Date.now()) {
  return `rg_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const INCIDENT_PHASES: ReadonlySet<GuardianPhase> = new Set([
  "failure_detected",
  "awaiting_user",
  "recovering",
  "fallback_active",
  "recovered",
  "unresolved"
]);

export const DEFERRED_FAILURES: ReadonlySet<FailureType> = new Set([
  "unexpected_disconnect",
  "read_loop_failure",
  "frozen_readings"
]);
