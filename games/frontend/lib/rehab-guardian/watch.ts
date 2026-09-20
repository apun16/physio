import { STALE_AFTER_MS, type SerialSensor } from "../racing/sensor";
import type { GuardianEvent, SensorReliabilityEvent } from "./types";

export type SensorWatchTarget = Pick<SerialSensor, "status" | "latest" | "isLive" | "subscribeReliability">;

function toGuardian(event: SensorReliabilityEvent): GuardianEvent | null {
  switch (event.kind) {
    case "connecting":
      return { type: "connecting", at: event.at };
    case "connected":
      return { type: "connected", at: event.at };
    case "first_valid_frame":
      return { type: "first_valid_frame", at: event.at };
    case "malformed_frame":
      return { type: "malformed_frame", at: event.at };
    case "invalid_values":
      return { type: "invalid_values", at: event.at };
    case "frozen_readings":
      return { type: "frozen_readings", at: event.at };
    case "unrealistic_jump":
      return { type: "unrealistic_jump", at: event.at };
    case "command_write_failed":
      return { type: "command_write_failed", at: event.at };
    case "command_ack_timeout":
      return { type: "command_ack_timeout", at: event.at };
    case "command_sent":
    case "firmware_ack":
      return null;
    case "read_loop_failure":
      return { type: "read_loop_failure", at: event.at };
    case "unexpected_disconnect":
      return { type: "unexpected_disconnect", at: event.at };
    case "intentionally_disconnected":
      return { type: "intentionally_disconnected", at: event.at };
    case "port_open_failed":
      return { type: "port_open_failed", at: event.at };
    case "port_picker_cancelled":
      return { type: "port_picker_cancelled", at: event.at };
    case "unsupported":
      return { type: "unsupported", at: event.at };
    default:
      return null;
  }
}

/**
 * Observes SerialSensor without replacing it.
 * Stale detection uses the existing isLive() / STALE_AFTER_MS contract.
 */
export function watchSensor(
  sensor: SensorWatchTarget,
  dispatch: (event: GuardianEvent) => void,
  options: { getInputMode?: () => "imu" | "hand"; getEnded?: () => boolean; intervalMs?: number } = {}
) {
  let staleSent = false;
  let stopped = false;

  const unsub = sensor.subscribeReliability((event) => {
    if (stopped) return;
    if (options.getEnded?.()) {
      if (event.kind === "unexpected_disconnect" || event.kind === "read_loop_failure" || event.kind === "intentionally_disconnected") return;
    }
    const mapped = toGuardian(event);
    if (mapped) {
      try {
        dispatch(mapped);
      } catch {
        // never break the IMU read loop
      }
    }
  });

  if (sensor.status === "unsupported") {
    dispatch({ type: "unsupported", at: performance.now() });
  }

  const intervalMs = options.intervalMs ?? 200;
  const timer = setInterval(() => {
    if (stopped) return;
    if (options.getEnded?.() || options.getInputMode?.() === "hand") {
      staleSent = false;
      return;
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const live = sensor.isLive(now);
    if (sensor.status === "connected" && sensor.latest && !live) {
      if (!staleSent) {
        staleSent = true;
        const elapsed = now - sensor.latest.t;
        if (elapsed >= STALE_AFTER_MS) dispatch({ type: "stream_stale", msSinceLastValid: elapsed, at: now });
      }
    } else if (live) {
      if (staleSent) dispatch({ type: "frames_stable" });
      staleSent = false;
    }
  }, intervalMs);

  return () => {
    stopped = true;
    unsub();
    clearInterval(timer);
  };
}
