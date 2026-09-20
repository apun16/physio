import type { GuardianState, SanitizedIncident } from "./types";

const APP_VERSION = "0.1.0";

const ALLOWED_KEYS = [
  "incidentId",
  "failureType",
  "game",
  "component",
  "inputMode",
  "source",
  "firmwarePacket",
  "msSinceLastValid",
  "malformedCount",
  "recoveryMethod",
  "recoveryResult",
  "diagnosis",
  "confirmation",
  "appVersion",
  "environment"
] as const;

const FORBIDDEN = /roll|pitch|yaw|steer|move|packet|landmark|email|name|diagnos|camera|image|video|voice|audio/i;

export function sanitizeIncident(state: GuardianState, environment = "development"): SanitizedIncident | null {
  if (!state.incidentId || !state.failureType) return null;
  return {
    incidentId: state.incidentId,
    failureType: state.failureType,
    game: "racing",
    component: "imu",
    inputMode: state.inputMode,
    source: state.source,
    firmwarePacket: "five-field",
    msSinceLastValid: state.msSinceLastValid,
    malformedCount: state.malformedCount,
    recoveryMethod: state.recoveryMethod,
    recoveryResult: state.recoveryResult,
    diagnosis: state.diagnosis,
    confirmation: state.confirmation,
    appVersion: APP_VERSION,
    environment
  };
}

export function assertSanitized(payload: SanitizedIncident) {
  const keys = Object.keys(payload);
  if (keys.some((key) => !ALLOWED_KEYS.includes(key as (typeof ALLOWED_KEYS)[number]))) {
    throw new Error("unexpected sentry field");
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === "firmwarePacket" && value === "five-field") continue;
    if (typeof value === "string" && FORBIDDEN.test(value)) {
      throw new Error("payload looks like raw sensor or personal data");
    }
  }
  return payload;
}

export function receiptLines(payload: SanitizedIncident | null) {
  if (!payload) {
    return {
      sent: [] as string[],
      never: [
        "Raw motion readings",
        "Serial packets",
        "Camera data",
        "Voice recordings",
        "Names or account identifiers",
        "Medical details"
      ]
    };
  }
  return {
    sent: [
      `Anonymous incident ID (${payload.incidentId})`,
      `Technical failure category (${payload.failureType})`,
      `Game and input mode (${payload.game} / ${payload.inputMode})`,
      `Timing and count metrics (${payload.msSinceLastValid ?? 0}ms since last valid frame, ${payload.malformedCount} malformed packets)`,
      `Recovery method and outcome (${payload.recoveryMethod ?? "none"} / ${payload.recoveryResult ?? "pending"})`,
      `Fixed-choice confirmation (${payload.diagnosis ?? "none"} / ${payload.confirmation ?? "none"})`
    ],
    never: [
      "Raw motion readings (roll, pitch, yaw, steer, move streams)",
      "Serial packets",
      "Camera data, images, or video",
      "Voice recordings",
      "Names, email addresses, or account identifiers",
      "Free-text medical information, diagnoses, or clinical conclusions"
    ]
  };
}
