import * as Sentry from "@sentry/nextjs";
import type { GuardianGame, GuardianPhase, GuardianState, SanitizedIncident } from "./types";
import { assertSanitized, sanitizeIncident } from "./privacy";

const RATE_MS = 12_000;
const lastFailureAt = new Map<string, number>();
const reportedIncidents = new Set<string>();
const openSpans = new Map<string, { end: () => void }>();

function safe(run: () => void) {
  try {
    run();
  } catch {
    // Guardian reporting must fail closed.
  }
}

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

export function breadcrumbTransition(from: GuardianPhase, to: GuardianPhase, source: GuardianState["source"]) {
  if (from === to) return;
  safe(() => {
    Sentry.addBreadcrumb({
      category: "rehab-guardian",
      message: `${from} -> ${to}`,
      level: "info",
      data: { source }
    });
  });
}

function startNamedSpan(name: string) {
  safe(() => {
    openSpans.get(name)?.end();
    const span = Sentry.startInactiveSpan({ name, op: "imu" });
    if (span) openSpans.set(name, span);
  });
}

function endNamedSpan(name: string) {
  safe(() => {
    openSpans.get(name)?.end();
    openSpans.delete(name);
  });
}

export function reportFailure(state: GuardianState, game: GuardianGame = "racing") {
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
  if (reportedIncidents.has(payload.incidentId) || now - last < RATE_MS && lastFailureAt.has(key)) {
    lastFailureAt.set(key, now);
    return payload;
  }
  lastFailureAt.set(key, now);
  reportedIncidents.add(payload.incidentId);

  safe(() => {
    startNamedSpan("imu.failure_detected");
    if (typeof payload.msSinceLastValid === "number") {
      Sentry.setMeasurement("imu.ms_since_last_valid", payload.msSinceLastValid, "millisecond");
    }
    Sentry.setMeasurement("imu.malformed_count", payload.malformedCount, "none");
    Sentry.withScope((scope) => {
      for (const [tag, value] of Object.entries(tags(payload))) scope.setTag(tag, value);
      scope.setFingerprint(["rehab-guardian", payload.failureType, payload.incidentId]);
      scope.setContext("rehab_guardian", payload);
      Sentry.captureException(new Error(`Rehab Guardian: ${payload.failureType}`));
    });
  });
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
  safe(() => {
    if (payload.recoveryResult === "success") {
      endNamedSpan("imu.recovery");
      endNamedSpan("imu.failure_detected");
      startNamedSpan("imu.healthy_session");
    } else {
      endNamedSpan("imu.recovery");
    }
    Sentry.withScope((scope) => {
      for (const [tag, value] of Object.entries(tags(payload))) scope.setTag(tag, value);
      scope.setFingerprint(["rehab-guardian-recovery", payload.incidentId]);
      scope.setContext("rehab_guardian", payload);
      Sentry.captureMessage(`Rehab Guardian recovery: ${payload.recoveryResult ?? "pending"}`, payload.recoveryResult === "success" ? "info" : "warning");
    });
  });
  return payload;
}

export function reportSpan(name: "imu.connect" | "imu.healthy_session" | "imu.failure_detected" | "imu.recovery" | "imu.fallback" | "imu.session", action: "start" | "end") {
  if (action === "start") startNamedSpan(name);
  else endNamedSpan(name);
}

export function reportSidekickFailure(game: GuardianGame = "racing") {
  safe(() => {
    Sentry.withScope((scope) => {
      scope.setTag("guardian.component", "imu");
      scope.setTag("guardian.game", game);
      scope.setTag("guardian.failure_type", "sidekick_failure");
      scope.setTag("guardian.source", "real");
      scope.setFingerprint(["rehab-guardian", "sidekick_failure"]);
      Sentry.captureMessage("Rehab Guardian: sidekick_failure", "warning");
    });
  });
}

export function resetReporterForTests() {
  lastFailureAt.clear();
  reportedIncidents.clear();
  for (const span of openSpans.values()) {
    try { span.end(); } catch { /* ignore */ }
  }
  openSpans.clear();
}
