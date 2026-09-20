import {
  DEFERRED_FAILURES,
  INCIDENT_PHASES,
  INITIAL_GUARDIAN_STATE,
  newIncidentId,
  type FailureType,
  type GuardianEvent,
  type GuardianState,
  type PromptKind
} from "./types";

function at(event: GuardianEvent, fallback: number) {
  return "at" in event && typeof event.at === "number" ? event.at : fallback;
}

function promptFor(failureType: FailureType): PromptKind {
  if (failureType === "unexpected_disconnect" || failureType === "read_loop_failure") return "intentional_disconnect";
  if (failureType === "frozen_readings") return "stillness";
  return "diagnosis";
}

function beginIncident(state: GuardianState, failureType: FailureType, now: number, extra: Partial<GuardianState> = {}): GuardianState {
  if (state.inputMode === "hand") return { ...state, lastEventAt: now };
  if (INCIDENT_PHASES.has(state.phase) && state.failureType === failureType) {
    return { ...state, lastEventAt: now, ...extra };
  }
  if (INCIDENT_PHASES.has(state.phase) && (failureType === "unexpected_disconnect" || failureType === "read_loop_failure")) {
    return {
      ...state,
      failureType,
      promptKind: "intentional_disconnect",
      sentryDeferred: true,
      greetingActive: false,
      lastEventAt: now,
      ...extra
    };
  }
  if (INCIDENT_PHASES.has(state.phase)) return { ...state, lastEventAt: now };
  return {
    ...state,
    phase: "failure_detected",
    failureType,
    incidentId: state.incidentId ?? newIncidentId(now),
    recoveryMethod: null,
    recoveryResult: null,
    confirmation: null,
    diagnosis: null,
    promptKind: promptFor(failureType),
    sentryDeferred: DEFERRED_FAILURES.has(failureType),
    greetingActive: false,
    lastEventAt: now,
    ...extra
  };
}

function clearBadPackets(): Pick<GuardianState, "malformedCount" | "malformedWindowStart" | "invalidCount" | "invalidWindowStart"> {
  return { malformedCount: 0, malformedWindowStart: null, invalidCount: 0, invalidWindowStart: null };
}

function recoverIfStreamReturned(state: GuardianState, now: number): GuardianState | null {
  if (state.phase !== "failure_detected" && state.phase !== "awaiting_user") return null;
  if (
    state.failureType !== "stale_stream" &&
    state.failureType !== "persistent_malformed" &&
    state.failureType !== "invalid_values"
  ) {
    return null;
  }
  return {
    ...state,
    phase: "healthy",
    failureType: null,
    incidentId: null,
    recoveryMethod: null,
    recoveryResult: null,
    promptKind: "none",
    sentryDeferred: false,
    greetingActive: false,
    lastEventAt: now,
    ...clearBadPackets()
  };
}

/** Deterministic Guardian reducer. Safe to unit-test without the DOM or Sentry. */
export function reduce(state: GuardianState, event: GuardianEvent): GuardianState {
  const now = at(event, state.lastEventAt);
  if (state.phase === "ended" && event.type !== "session_start") return state;

  switch (event.type) {
    case "session_start":
      return { ...INITIAL_GUARDIAN_STATE, greetingActive: false, lastEventAt: now, source: "real", inputMode: state.inputMode };
    case "dismiss_greeting":
      return { ...state, greetingActive: false, lastEventAt: now };
    case "set_input_mode":
      return { ...state, inputMode: event.mode, lastEventAt: now };
    case "set_source":
      return { ...state, source: event.source, lastEventAt: now };
    case "session_end":
      return { ...state, phase: "ended", greetingActive: false, promptKind: "none", lastEventAt: now };

    case "port_picker_cancelled":
      return {
        ...state,
        phase: state.phase === "connecting" ? "pre_game" : state.phase,
        lastEventAt: now
      };

    case "intentionally_disconnected":
      if (state.phase === "ended") return state;
      return {
        ...state,
        phase: "pre_game",
        failureType: null,
        incidentId: null,
        recoveryMethod: null,
        recoveryResult: "suppressed",
        promptKind: "none",
        sentryDeferred: false,
        greetingActive: false,
        lastEventAt: now,
        ...clearBadPackets()
      };

    case "unsupported":
      return beginIncident(state, "web_serial_unsupported", now);
    case "port_open_failed":
      return beginIncident(state, "port_open_failed", now);
    case "unrealistic_jump":
    case "command_ack_timeout":
    case "command_write_failed":
    case "frozen_readings":
    case "stream_stale":
      // Demo-safe: never overlay for noisy MPU6050 play, stillness, or brief BT gaps.
      return { ...state, lastEventAt: now };
    case "fallback_failed":
      return beginIncident(state, "fallback_failed", now);

    case "connecting":
      if (INCIDENT_PHASES.has(state.phase) && state.phase !== "recovered") {
        return { ...state, phase: "recovering", recoveryMethod: state.recoveryMethod ?? "reconnect", lastEventAt: now };
      }
      return { ...state, phase: "connecting", greetingActive: false, lastEventAt: now, ...clearBadPackets() };

    case "connected":
      if (state.phase === "recovering" || state.phase === "failure_detected" || state.phase === "awaiting_user" || state.phase === "unresolved") {
        return { ...state, phase: "recovering", recoveryMethod: state.recoveryMethod ?? "reconnect", lastEventAt: now };
      }
      if (state.phase === "pre_game" || state.phase === "connecting") {
        return { ...state, phase: "connecting", lastEventAt: now };
      }
      return { ...state, lastEventAt: now };

    case "first_valid_frame": {
      const resumed = recoverIfStreamReturned(state, now);
      if (resumed) return resumed;
      if (state.phase === "recovering") {
        return {
          ...state,
          phase: "recovered",
          recoveryResult: "success",
          promptKind: "confirm",
          lastEventAt: now,
          ...clearBadPackets()
        };
      }
      if (state.phase === "unresolved") return { ...state, lastEventAt: now };
      if (state.phase === "degraded") {
        return { ...state, phase: "healthy", lastEventAt: now, ...clearBadPackets() };
      }
      if (state.phase === "connecting" || state.phase === "pre_game" || state.phase === "healthy") {
        return { ...state, phase: "healthy", greetingActive: false, lastEventAt: now, ...clearBadPackets() };
      }
      return { ...state, lastEventAt: now };
    }

    case "malformed_frame":
    case "invalid_values":
      return { ...state, lastEventAt: now };

    case "unexpected_disconnect":
    case "read_loop_failure":
      if (state.inputMode === "hand") return { ...state, lastEventAt: now };
      if (state.phase === "pre_game" || state.phase === "ended") return { ...state, lastEventAt: now };
      return beginIncident(state, event.type, now);

    case "prompt_user":
      if (state.phase === "failure_detected") return { ...state, phase: "awaiting_user", lastEventAt: now };
      return state;

    case "user_intent":
      if (state.phase !== "awaiting_user" && state.phase !== "failure_detected") return state;
      if (event.intentional) {
        return {
          ...state,
          phase: "pre_game",
          failureType: null,
          incidentId: null,
          recoveryResult: "suppressed",
          promptKind: "none",
          sentryDeferred: false,
          greetingActive: false,
          lastEventAt: now,
          ...clearBadPackets()
        };
      }
      return {
        ...state,
        phase: "awaiting_user",
        promptKind: "recovery",
        sentryDeferred: false,
        lastEventAt: now
      };

    case "user_diagnosis":
      if (state.phase !== "awaiting_user" && state.phase !== "failure_detected") return state;
      if (event.choice === "intentionally_still") {
        return {
          ...state,
          phase: "healthy",
          diagnosis: event.choice,
          failureType: null,
          incidentId: null,
          recoveryResult: "suppressed",
          promptKind: "none",
          sentryDeferred: false,
          greetingActive: false,
          lastEventAt: now,
          ...clearBadPackets()
        };
      }
      return { ...state, phase: "awaiting_user", diagnosis: event.choice, promptKind: "recovery", sentryDeferred: false, lastEventAt: now };

    case "start_recovery":
      if (state.phase === "awaiting_user" || state.phase === "failure_detected" || state.phase === "unresolved" || state.phase === "recovered") {
        if (event.method === "hand_cam_fallback") {
          return {
            ...state,
            phase: "fallback_active",
            recoveryMethod: event.method,
            inputMode: "hand",
            promptKind: "confirm",
            lastEventAt: now
          };
        }
        if (event.method === "pause_and_exit") {
          return { ...state, phase: "ended", recoveryMethod: event.method, promptKind: "none", lastEventAt: now };
        }
        return { ...state, phase: "recovering", recoveryMethod: event.method, promptKind: "none", lastEventAt: now };
      }
      return state;

    case "frames_stable": {
      const resumed = recoverIfStreamReturned(state, now);
      if (resumed) return resumed;
      if (state.phase === "degraded") {
        return { ...state, phase: "healthy", lastEventAt: now, ...clearBadPackets() };
      }
      if (state.phase === "recovering" || state.phase === "fallback_active") {
        return {
          ...state,
          phase: "recovered",
          recoveryResult: "success",
          promptKind: "confirm",
          lastEventAt: now,
          ...clearBadPackets()
        };
      }
      return { ...state, lastEventAt: now };
    }

    case "recovery_unresolved":
      if (state.phase === "recovering" || state.phase === "awaiting_user" || state.phase === "fallback_active") {
        return {
          ...state,
          phase: "unresolved",
          recoveryResult: "unresolved",
          failureType: state.failureType ?? "recovery_unresolved",
          promptKind: "recovery",
          lastEventAt: now
        };
      }
      return state;

    case "user_confirms":
      if (state.phase !== "recovered" && state.phase !== "fallback_active" && state.phase !== "unresolved") return state;
      if (event.choice === "works_now") {
        return {
          ...state,
          phase: "healthy",
          confirmation: event.choice,
          recoveryResult: "success",
          promptKind: "none",
          greetingActive: false,
          lastEventAt: now,
          ...clearBadPackets()
        };
      }
      return {
        ...state,
        phase: "awaiting_user",
        confirmation: event.choice,
        recoveryResult: "unresolved",
        promptKind: "recovery",
        lastEventAt: now
      };

    default:
      return state;
  }
}

export function isSidekickVisible(state: GuardianState, gameRunning: boolean) {
  if (state.phase === "ended") return false;
  if (state.greetingActive) return true;
  if (gameRunning && (state.phase === "healthy" || state.phase === "degraded" || state.phase === "pre_game")) return false;
  if (state.phase === "healthy" || state.phase === "degraded" || state.phase === "pre_game") return false;
  return true;
}

export function createGuardian(seed: Partial<GuardianState> = {}): GuardianState {
  return { ...INITIAL_GUARDIAN_STATE, ...seed };
}
