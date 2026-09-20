import type { GuardianGame, GuardianPhase, GuardianState, SanitizedIncident } from "./types";
import { assertSanitized, sanitizeIncident } from "./privacy";
import { sentrySdk, type GuardianScope } from "./sentry-sdk";

const RATE_MS = 12_000;
const lastFailureAt = new Map<string, number>();
const reportedIncidents = new Set<string>();
const openSpans = new Map<string, { end: () => void }>();

function tags(payload: SanitizedIncident) {
  return {
    "guardian.component": "imu",
    "guardian.game": payload.game,
    "guardian.failure_type": payload.failureType,
    "guardian.recovery_method": payload.recoveryMethod ?? "none",
    "guardian.recovery_result": payload.recoveryResult ?? "pending",
    "guardian.input_mode": payload.inputMode,
    "guardian.source": payload.source,
    "guardian.firmware_packet": "five-field"
  };
}

function applyTags(scope: GuardianScope, payload: SanitizedIncident) {
  for (const [tag, value] of Object.entries(tags(payload))) scope.setTag(tag, value);
}

function sendException(message: string, payload: SanitizedIncident, fingerprint: string[]): boolean {
  const sentry = sentrySdk();
  const captureEx = sentry.captureException;
  const captureMsg = sentry.captureMessage;
  if (typeof captureEx !== "function" && typeof captureMsg !== "function") {
    console.warn("[rehab-guardian] Sentry capture is not available; IMU incident not sent:", message);
    return false;
  }
  const error = new Error(message);
  const capture = () => {
    if (typeof captureEx === "function") return captureEx(error);
    return captureMsg?.(message, "error");
  };
  const decorate = (scope: GuardianScope) => {
    applyTags(scope, payload);
    scope.setFingerprint(fingerprint);
    scope.setContext("rehab_guardian", payload);
  };
  try {
    if (typeof sentry.withScope === "function") {
      sentry.withScope((scope) => {
        try {
          decorate(scope);
        } catch {
          // still capture the exception
        }
        capture();
      });
    } else {
      capture();
    }
    console.info("[rehab-guardian] sent to Sentry:", message);
    return true;
  } catch (err) {
    console.warn("[rehab-guardian] Sentry send failed:", err);
    try {
      captureMsg?.(message, "error");
      return true;
    } catch {
      return false;
    }
  }
}

function sendMessage(message: string, payload: SanitizedIncident, level: "info" | "warning") {
  const sentry = sentrySdk();
  if (typeof sentry.captureMessage !== "function") return;
  if (typeof sentry.withScope === "function") {
    sentry.withScope((scope) => {
      applyTags(scope, payload);
      scope.setFingerprint(["rehab-guardian-recovery", payload.failureType]);
      scope.setContext("rehab_guardian", payload);
      sentry.captureMessage?.(message, level);
    });
  } else {
    sentry.captureMessage(message, level);
  }
}

export function breadcrumbTransition(from: GuardianPhase, to: GuardianPhase, source: GuardianState["source"]) {
  if (from === to) return;
  const sentry = sentrySdk();
  sentry.addBreadcrumb?.({
    category: "rehab-guardian",
    message: `${from} -> ${to}`,
    level: "info",
    data: { source }
  });
}

function startNamedSpan(name: string) {
  const sentry = sentrySdk();
  if (typeof sentry.startInactiveSpan !== "function") return;
  try {
    openSpans.get(name)?.end();
    const span = sentry.startInactiveSpan({ name, op: "imu" });
    if (span) openSpans.set(name, span);
  } catch {
    // spans are optional
  }
}

function endNamedSpan(name: string) {
  try {
    openSpans.get(name)?.end();
    openSpans.delete(name);
  } catch {
    // spans are optional
  }
}

export function reportFailure(state: GuardianState, game: GuardianGame = "racing", opts: { force?: boolean } = {}) {
  const payload = sanitizeIncident(state, process.env.NODE_ENV ?? "development", game);
  if (!payload) return null;
  try {
    assertSanitized(payload);
  } catch {
    return null;
  }

  const key = `${payload.failureType}:${payload.source}`;
  const now = Date.now();
  const last = lastFailureAt.get(key) ?? 0;
  if (!opts.force && (reportedIncidents.has(payload.incidentId) || (now - last < RATE_MS && lastFailureAt.has(key)))) {
    lastFailureAt.set(key, now);
    return payload;
  }

  const sent = sendException(`Rehab Guardian: ${payload.failureType}`, payload, ["rehab-guardian", payload.failureType]);
  if (!sent) return payload;

  lastFailureAt.set(key, now);
  reportedIncidents.add(payload.incidentId);
  const sentry = sentrySdk();
  if (typeof sentry.setMeasurement === "function") {
    try {
      if (typeof payload.msSinceLastValid === "number") {
        sentry.setMeasurement("imu.ms_since_last_valid", payload.msSinceLastValid, "millisecond");
      }
      sentry.setMeasurement("imu.malformed_count", payload.malformedCount, "none");
    } catch {
      // measurements are optional
    }
  }
  startNamedSpan("imu.failure_detected");
  return payload;
}

export function reportRecovery(state: GuardianState, game: GuardianGame = "racing") {
  const payload = sanitizeIncident(state, process.env.NODE_ENV ?? "development", game);
  if (!payload) return null;
  try {
    assertSanitized(payload);
  } catch {
    return null;
  }
  if (payload.recoveryResult === "success") {
    endNamedSpan("imu.recovery");
    endNamedSpan("imu.failure_detected");
    startNamedSpan("imu.healthy_session");
  } else {
    endNamedSpan("imu.recovery");
  }
  sendMessage(`Rehab Guardian recovery: ${payload.recoveryResult ?? "pending"}`, payload, payload.recoveryResult === "success" ? "info" : "warning");
  return payload;
}

export function reportSpan(name: "imu.connect" | "imu.healthy_session" | "imu.failure_detected" | "imu.recovery" | "imu.fallback" | "imu.session", action: "start" | "end") {
  if (action === "start") startNamedSpan(name);
  else endNamedSpan(name);
}

export function reportSidekickFailure(game: GuardianGame = "racing") {
  const sentry = sentrySdk();
  if (typeof sentry.withScope === "function") {
    sentry.withScope((scope) => {
      scope.setTag("guardian.component", "imu");
      scope.setTag("guardian.game", game);
      scope.setTag("guardian.failure_type", "sidekick_failure");
      sentry.captureMessage?.("Rehab Guardian: sidekick_failure", "warning");
    });
    return;
  }
  sentry.captureMessage?.("Rehab Guardian: sidekick_failure", "warning");
}

export function resetReporterForTests() {
  lastFailureAt.clear();
  reportedIncidents.clear();
  for (const span of openSpans.values()) {
    try { span.end(); } catch { /* ignore */ }
  }
  openSpans.clear();
}
