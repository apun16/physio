import { afterEach, describe, expect, it, vi } from "vitest";
import { STALE_AFTER_MS } from "../racing/sensor";
import type { GuardianEvent, SensorReliabilityEvent } from "./types";
import { watchSensor, type SensorWatchTarget } from "./watch";

function fakeSensor(overrides: Partial<SensorWatchTarget> & { emit?: (event: SensorReliabilityEvent) => void } = {}) {
  const listeners = new Set<(event: SensorReliabilityEvent) => void>();
  const sensor: SensorWatchTarget & { emit: (event: SensorReliabilityEvent) => void } = {
    status: "connected",
    latest: { t: 0, roll: 0, pitch: 0, yaw: 0, steer: 0, move: 0 },
    isLive: () => false,
    subscribeReliability(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(event) {
      listeners.forEach((listener) => listener(event));
    },
    ...overrides
  };
  return sensor;
}

describe("sensor watch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits one stale-stream incident using isLive / STALE_AFTER_MS", () => {
    vi.useFakeTimers();
    const now = 10_000;
    vi.spyOn(performance, "now").mockReturnValue(now);
    const sensor = fakeSensor({
      latest: { t: now - STALE_AFTER_MS - 20, roll: 0, pitch: 0, yaw: 0, steer: 0, move: 0 },
      isLive: () => false
    });
    const events: GuardianEvent[] = [];
    watchSensor(sensor, (event) => events.push(event), { intervalMs: 200 });
    vi.advanceTimersByTime(450);
    const stale = events.filter((event) => event.type === "stream_stale");
    expect(stale).toHaveLength(1);
    if (stale[0].type === "stream_stale") expect(stale[0].msSinceLastValid).toBeGreaterThanOrEqual(STALE_AFTER_MS);
  });

  it("does not treat a cancelled port picker as a failure event mapping", () => {
    const sensor = fakeSensor({ status: "disconnected", latest: null, isLive: () => false });
    const events: GuardianEvent[] = [];
    watchSensor(sensor, (event) => events.push(event));
    sensor.emit({ kind: "port_picker_cancelled", at: 1 });
    expect(events.some((event) => event.type === "port_picker_cancelled")).toBe(true);
    expect(events.some((event) => event.type === "port_open_failed")).toBe(false);
  });
});
