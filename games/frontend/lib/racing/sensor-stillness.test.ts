import { describe, expect, it } from "vitest";
import { rangeLooksActive, type SensorFrame } from "./sensor";

function frame(partial: Partial<SensorFrame>): SensorFrame {
  return {
    roll: 0,
    pitch: 0,
    yaw: 0,
    steer: 0,
    move: 0,
    moveY: 0,
    squeeze: 0,
    rawFsr: 0,
    t: 0,
    ...partial
  };
}

describe("rangeLooksActive", () => {
  it("does not treat MPU6050 noise as motion", () => {
    expect(rangeLooksActive(frame({ roll: 0 }), frame({ roll: 1.2 }))).toBe(false);
    expect(rangeLooksActive(frame({ move: 0 }), frame({ move: 0.04 }))).toBe(false);
  });

  it("treats X, Y, squeeze, and angle sweeps as motion", () => {
    expect(rangeLooksActive(frame({ move: 0 }), frame({ move: 0.3 }))).toBe(true);
    expect(rangeLooksActive(frame({ moveY: 0 }), frame({ moveY: 0.25 }))).toBe(true);
    expect(rangeLooksActive(frame({ squeeze: 0.1 }), frame({ squeeze: 0.4 }))).toBe(true);
    expect(rangeLooksActive(frame({ roll: 0 }), frame({ roll: 12 }))).toBe(true);
    expect(rangeLooksActive(frame({ steer: 0 }), frame({ steer: 0.2 }))).toBe(true);
  });
});
